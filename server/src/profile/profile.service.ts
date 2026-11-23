import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { sniffSignature } from '../common/utils/file-signature.util';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

export type ProfileImageKind = 'avatar' | 'cover';
export const PROFILE_IMAGE_KINDS: ProfileImageKind[] = ['avatar', 'cover'];

/** Per kind: the column it lives in and the largest file accepted. */
const KINDS: Record<
  ProfileImageKind,
  { column: 'avatarKey' | 'coverKey'; maxBytes: number }
> = {
  avatar: { column: 'avatarKey', maxBytes: 5 * 1024 * 1024 },
  cover: { column: 'coverKey', maxBytes: 8 * 1024 * 1024 },
};

/**
 * Raster formats only. SVG is refused outright: it is a document that can
 * carry script, and served back on this origin it would be stored XSS. The
 * check is on the bytes, not the extension or the client's Content-Type, both
 * of which the uploader controls.
 */
const ALLOWED: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The signed-in user's own profile photo and cover image.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ONLY EVER THE CALLER'S OWN. Every method takes the authenticated user and
 *  nothing else to identify the account — there is no user id in any route —
 *  so there is no id to tamper with.
 *
 *  STORED AS KEYS, SERVED THROUGH THE API. The bytes go through the storage
 *  interface (S3, R2, MinIO or local disk alike) under `t/<tenant>/profile/`,
 *  and the column holds the key. Reads come back through `/profile/:kind`
 *  with the caller's token, so an image is never at a public or long-lived
 *  URL. They are small and cached by the browser, so the extra hop is cheap.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Which images exist, with a token that changes whenever one does. */
  async summary(user: AuthenticatedUser) {
    const row = await this.load(user);
    return {
      avatar: versionOf(row.avatarKey),
      cover: versionOf(row.coverKey),
    };
  }

  async read(user: AuthenticatedUser, kind: ProfileImageKind) {
    const row = await this.load(user);
    const key = row[KINDS[kind].column];
    if (!key) {
      throw new NotFoundException('لا توجد صورة - No image');
    }

    const buffer = await this.storage.getObject(user.tenantId, key);
    // Re-sniffed on the way out, so the Content-Type is what the bytes are,
    // never something stored or supplied.
    const contentType = ALLOWED[sniffSignature(buffer)];
    if (!contentType) {
      throw new NotFoundException('لا توجد صورة - No image');
    }
    return { buffer, contentType };
  }

  async upload(
    user: AuthenticatedUser,
    kind: ProfileImageKind,
    file: Express.Multer.File | undefined,
  ) {
    const { column, maxBytes } = KINDS[kind];

    if (!file?.buffer?.length) {
      throw new BadRequestException('لم يتم إرفاق صورة - No image was attached');
    }
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `حجم الصورة يتجاوز ${maxBytes / 1024 / 1024} ميجابايت - ` +
          `The image is larger than ${maxBytes / 1024 / 1024} MB`,
      );
    }

    const contentType = ALLOWED[sniffSignature(file.buffer)];
    if (!contentType) {
      throw new BadRequestException({
        message:
          'نوع الملف غير مدعوم؛ استخدم JPG أو PNG أو WebP - ' +
          'Unsupported file type; use JPG, PNG or WebP',
        errorCode: 'UNSUPPORTED_IMAGE',
      });
    }

    const row = await this.load(user);
    const previous = row[column];

    const stored = await this.storage.putObject({
      tenantId: user.tenantId,
      prefix: 'profile',
      fileName: `${kind}${EXTENSION[contentType]}`,
      body: file.buffer,
      contentType,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { [column]: stored.key },
    });

    if (previous) await this.removeObject(user.tenantId, previous);

    await this.audit.log({
      tenantId: user.tenantId,
      action: kind === 'avatar' ? 'PROFILE_PHOTO_UPDATED' : 'PROFILE_COVER_UPDATED',
      category: 'USER',
      actorType: user.principalType,
      actorId: user.id,
      actorName: user.fullName,
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.email,
    });

    return this.summary(user);
  }

  async remove(user: AuthenticatedUser, kind: ProfileImageKind) {
    const { column } = KINDS[kind];
    const row = await this.load(user);
    const key = row[column];

    if (key) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { [column]: null },
      });
      await this.removeObject(user.tenantId, key);

      await this.audit.log({
        tenantId: user.tenantId,
        action: kind === 'avatar' ? 'PROFILE_PHOTO_REMOVED' : 'PROFILE_COVER_REMOVED',
        category: 'USER',
        actorType: user.principalType,
        actorId: user.id,
        actorName: user.fullName,
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
      });
    }

    return this.summary(user);
  }

  private async load(user: AuthenticatedUser) {
    const row = await this.prisma.user.findFirst({
      where: { tenantId: user.tenantId, id: user.id, deletedAt: null },
      select: { avatarKey: true, coverKey: true },
    });
    if (!row) {
      throw new NotFoundException('المستخدم غير موجود - User not found');
    }
    return row;
  }

  /**
   * Best effort: the row no longer points at the file, so a failed delete
   * leaves an orphan in the bucket, never a broken profile. Logged so it can
   * be swept.
   */
  private async removeObject(tenantId: string, key: string) {
    try {
      await this.storage.deleteObject(tenantId, key);
    } catch (error) {
      this.logger.warn(
        `Could not delete replaced profile image ${key}: ${(error as Error).message}`,
      );
    }
  }
}

/** The file name part of a key: unique per upload, and reveals nothing. */
function versionOf(key: string | null): string | null {
  if (!key) return null;
  return key.slice(key.lastIndexOf('/') + 1);
}
