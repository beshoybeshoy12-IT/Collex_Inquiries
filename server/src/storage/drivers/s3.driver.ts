import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageDriver } from '../storage.driver';

export interface S3DriverConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * S3-compatible storage: AWS S3, Cloudflare R2 and MinIO, unmodified.
 *
 * The three differ only in configuration:
 *
 *   AWS S3   — no endpoint, a real region, virtual-host addressing.
 *   R2       — endpoint `https://<account>.r2.cloudflarestorage.com`,
 *              region `auto`.
 *   MinIO    — endpoint `http://minio:9000`, path-style addressing required.
 *
 * `forcePathStyle` is the only behavioural switch, and it is a config value
 * rather than a branch on a provider name — which is what keeps this driver
 * from growing a vendor `switch` the way these classes always do.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  readonly supportsPresign = true;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: S3DriverConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        // Server-side encryption at rest. This database holds national ids and
        // photographs of people's homes; an unencrypted bucket is not a
        // defensible default even when the bucket is private.
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const body = response.Body as unknown as AsyncIterable<Uint8Array>;
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async head(
    key: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string }> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        exists: true,
        size: response.ContentLength,
        contentType: response.ContentType,
      };
    } catch {
      // A 404 and a permissions failure are indistinguishable here by design —
      // callers only ever need "can I read it".
      return { exists: false };
    }
  }

  /**
   * `ContentType` and `ContentLength` are bound into the signature, so the URL
   * only accepts the upload that was actually authorised. Without them a
   * presigned PUT accepts any bytes of any size.
   */
  async presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        ServerSideEncryption: 'AES256',
      }),
      { expiresIn: input.expiresIn },
    );
  }

  async presignGet(input: {
    key: string;
    expiresIn: number;
    downloadFileName?: string;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ...(input.downloadFileName
          ? {
              // Forces a download with the original name rather than the UUID
              // key, and — importantly — stops the browser rendering an
              // uploaded HTML or SVG file inline on the bucket's origin.
              ResponseContentDisposition: `attachment; filename="${sanitiseFileName(
                input.downloadFileName,
              )}"`,
            }
          : {}),
      }),
      { expiresIn: input.expiresIn },
    );
  }
}

/** Strip anything that would break out of the quoted header value. */
function sanitiseFileName(name: string): string {
  return name.replace(/["\\\r\n]/g, '').slice(0, 200) || 'download';
}
