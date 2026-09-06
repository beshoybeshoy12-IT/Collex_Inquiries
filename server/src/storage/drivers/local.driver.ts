import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { StorageDriver } from '../storage.driver';

/**
 * Filesystem storage, for local development only.
 *
 * It exists so `npm run start:local` works with no cloud account, not as a
 * production option — `StorageService` says so loudly at boot. It cannot sign
 * URLs, so `supportsPresign` is false and the media service routes uploads and
 * downloads through the API instead. That is the honest degradation: the same
 * code paths run, just slower, and nothing pretends a presigned URL was issued.
 *
 * The path check below is not decoration. Keys are built by the service and are
 * safe by construction, but a driver that resolves `../../etc/passwd` because
 * one caller passed a key from somewhere else is a file-disclosure bug waiting
 * for that caller to exist.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  readonly supportsPresign = false;

  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a key inside the root, or refuse. */
  private pathFor(key: string): string {
    const target = resolve(join(this.root, normalize(key)));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return target;
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  async head(
    key: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string }> {
    try {
      const stats = await stat(this.pathFor(key));
      return { exists: true, size: stats.size };
    } catch {
      return { exists: false };
    }
  }

  /**
   * There is no signing key, so these throw rather than returning a URL that
   * would not work. Callers check `supportsPresign` first; this is the guard
   * for the one that forgets.
   *
   * They stay `async` with no `await` deliberately: the driver interface
   * returns a Promise, and an async function that throws returns a REJECTED
   * promise. Dropping `async` would make these throw synchronously, past any
   * caller that only wrote `.catch()`.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async presignPut(): Promise<string> {
    throw new Error(
      'The local storage driver cannot issue presigned upload URLs. ' +
        'Set STORAGE_DRIVER=s3, or upload through the API endpoint.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async presignGet(): Promise<string> {
    throw new Error(
      'The local storage driver cannot issue presigned download URLs. ' +
        'Set STORAGE_DRIVER=s3, or download through the API endpoint.',
    );
  }
}
