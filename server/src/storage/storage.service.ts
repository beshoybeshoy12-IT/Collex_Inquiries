import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { env, envBool, envInt } from '../common/config/env';
import { StorageDriver, PutObjectInput, StoredObject } from './storage.driver';
import { S3StorageDriver } from './drivers/s3.driver';
import { LocalStorageDriver } from './drivers/local.driver';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Object storage.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  NOTHING IN THE APPLICATION KNOWS WHICH PROVIDER IS BEHIND THIS. Services ask
 *  for a key, a presigned upload URL or a download URL; whether that is AWS S3,
 *  Cloudflare R2 or a MinIO box in the corner of the office is one environment
 *  variable. Collex System V1 wired Cloudinary directly into a dozen services
 *  and made "move to S3" a refactor rather than a config change — this is the
 *  same lesson, applied before the coupling exists.
 *
 *  THE KEY IS THE SECURITY BOUNDARY. Every key begins `t/<tenantId>/`, and the
 *  service refuses to read or delete a key that does not begin with the caller's
 *  tenant prefix. Buckets are shared; prefixes are not. A leaked key from one
 *  tenant is unusable from another tenant's session even if the URL is guessed
 *  perfectly.
 *
 *  UPLOADS PREFER TO SKIP THE API. `presignUpload` hands the browser or the
 *  handset a URL it PUTs straight to the bucket, so a 20 MB site video does not
 *  occupy a Node process for its whole transfer. The row is created first, in
 *  PENDING_UPLOAD, and confirmed afterwards — so an abandoned upload leaves a
 *  visible unfinished record rather than a file nobody knows about.
 *
 *  The local driver is for development only and says so at boot. It cannot
 *  issue real presigned URLs, so it returns API-routed URLs instead; that is
 *  slower and entirely fine on a laptop.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private driver: StorageDriver;

  /** Hard ceiling, checked before a presigned URL is issued. */
  readonly maxUploadBytes = envInt('UPLOAD_MAX_MB', 25) * 1024 * 1024;
  readonly presignTtlSeconds = envInt('S3_PRESIGN_TTL', 900);

  constructor() {
    const driverName = env('STORAGE_DRIVER', 'local').toLowerCase();

    if (driverName === 's3') {
      this.driver = new S3StorageDriver({
        endpoint: env('S3_ENDPOINT') || undefined,
        region: env('S3_REGION', 'auto'),
        bucket: env('S3_BUCKET', 'collex-inquiries'),
        accessKeyId: env('S3_ACCESS_KEY_ID'),
        secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
        forcePathStyle: envBool('S3_FORCE_PATH_STYLE', true),
      });
    } else {
      this.driver = new LocalStorageDriver(
        env('STORAGE_LOCAL_ROOT', './storage'),
      );
    }
  }

  onModuleInit(): void {
    this.logger.log(`Storage driver: ${this.driver.name}`);
    if (this.driver.name === 'local') {
      this.logger.warn(
        'STORAGE_DRIVER=local writes files to the container filesystem and ' +
          'cannot issue presigned URLs, so every upload and download passes ' +
          'through the API process. Use s3 (AWS S3, Cloudflare R2 or MinIO) ' +
          'for anything but local development.',
      );
    }
  }

  get supportsPresignedUploads(): boolean {
    return this.driver.supportsPresign;
  }

  /**
   * Build a storage key.
   *
   * Shape: `t/<tenant>/<prefix>/<yyyy>/<mm>/<uuid><ext>`
   *
   *  - the tenant segment first, because it is what every access check compares;
   *  - date segments, so a bucket listing is navigable and a lifecycle rule can
   *    expire by age;
   *  - a UUID rather than the user's filename, because filenames collide, carry
   *    personal data, and are a path-traversal vector. The original name is kept
   *    on the database row, which is where it belongs.
   */
  buildKey(input: {
    tenantId: string;
    prefix: string;
    fileName: string;
  }): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Extension only, lowercased, and only if it looks like one — never any
    // other part of the supplied name.
    const raw = extname(input.fileName || '').toLowerCase();
    const ext = /^\.[a-z0-9]{1,8}$/.test(raw) ? raw : '';

    const safePrefix = input.prefix.replace(/[^a-z0-9-]/gi, '') || 'misc';

    return `t/${input.tenantId}/${safePrefix}/${year}/${month}/${randomUUID()}${ext}`;
  }

  /** The prefix every one of a tenant's keys must start with. */
  private tenantPrefix(tenantId: string): string {
    return `t/${tenantId}/`;
  }

  /**
   * Refuse a key belonging to another tenant.
   *
   * Called on every read, download and delete. The keys come from database rows
   * that are themselves tenant-scoped, so this is defence in depth — and it is
   * cheap enough that there is no reason not to.
   */
  assertTenantOwnsKey(tenantId: string, key: string): void {
    if (!key.startsWith(this.tenantPrefix(tenantId))) {
      throw new Error(
        `Storage key "${key}" does not belong to tenant ${tenantId}`,
      );
    }
  }

  /** Upload through the API. Used for generated files and small uploads. */
  async putObject(
    input: Omit<PutObjectInput, 'key'> & { key?: string },
  ): Promise<StoredObject> {
    const key =
      input.key ??
      this.buildKey({
        tenantId: input.tenantId,
        prefix: input.prefix,
        fileName: input.fileName,
      });

    if (input.key) this.assertTenantOwnsKey(input.tenantId, input.key);

    await this.driver.put({
      key,
      body: input.body,
      contentType: input.contentType,
    });

    return {
      key,
      size: input.body.length,
      contentType: input.contentType,
    };
  }

  /**
   * A URL the client PUTs the file to directly.
   *
   * The content type and length are bound into the signature, so a client that
   * asked to upload a 2 MB JPEG cannot then push a 2 GB executable to the same
   * URL.
   */
  async presignUpload(input: {
    tenantId: string;
    prefix: string;
    fileName: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ key: string; url: string; expiresIn: number; method: 'PUT' }> {
    if (input.contentLength > this.maxUploadBytes) {
      throw new Error(
        `File exceeds the ${Math.round(this.maxUploadBytes / 1024 / 1024)} MB limit`,
      );
    }

    const key = this.buildKey(input);
    const url = await this.driver.presignPut({
      key,
      contentType: input.contentType,
      contentLength: input.contentLength,
      expiresIn: this.presignTtlSeconds,
    });

    return { key, url, expiresIn: this.presignTtlSeconds, method: 'PUT' };
  }

  /**
   * A short-lived URL for reading one object.
   *
   * Short-lived on purpose: a signed URL is a bearer token for that file, and
   * evidence photographs of somebody's home are exactly the thing that should
   * not be permanently linkable from a pasted URL.
   */
  async presignDownload(
    tenantId: string,
    key: string,
    fileName?: string,
    inline = false,
  ): Promise<{ url: string; expiresIn: number }> {
    this.assertTenantOwnsKey(tenantId, key);

    const url = await this.driver.presignGet({
      key,
      expiresIn: this.presignTtlSeconds,
      downloadFileName: fileName,
      inline,
    });

    return { url, expiresIn: this.presignTtlSeconds };
  }

  async getObject(tenantId: string, key: string): Promise<Buffer> {
    this.assertTenantOwnsKey(tenantId, key);
    return this.driver.get(key);
  }

  async deleteObject(tenantId: string, key: string): Promise<void> {
    this.assertTenantOwnsKey(tenantId, key);
    await this.driver.delete(key);
  }

  /** Whether the object is actually there — used to confirm a direct upload. */
  async headObject(
    tenantId: string,
    key: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string }> {
    this.assertTenantOwnsKey(tenantId, key);
    return this.driver.head(key);
  }
}
