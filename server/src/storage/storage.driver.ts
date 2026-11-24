/**
 * The contract every storage backend implements.
 *
 * Deliberately small. Everything the application needs from object storage is
 * here, and nothing provider-specific leaks through — no S3 command objects,
 * no Cloudinary transformation strings. A driver that cannot presign says so
 * through `supportsPresign` rather than throwing at the call site.
 */

export interface PutObjectInput {
  tenantId: string;
  prefix: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  key?: string;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;
  readonly supportsPresign: boolean;

  put(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  head(
    key: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string }>;

  presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  }): Promise<string>;

  presignGet(input: {
    key: string;
    expiresIn: number;
    downloadFileName?: string;
    /** Show in place instead of downloading. Callers allow it only for viewable types. */
    inline?: boolean;
  }): Promise<string>;
}
