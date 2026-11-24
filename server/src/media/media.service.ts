import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaStatus, MediaType, Prisma, PrincipalType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { isAcceptableFor } from '../common/utils/file-signature.util';
import {
  ConfirmUploadDto,
  MediaQueryDto,
  RequestUploadDto,
  UpsertMediaCategoryDto,
} from './dto/media.dto';
import {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import {
  decodeUploadName,
  isViewable,
  safeFileName,
} from '../common/utils/file-name.util';

/** Content types accepted per media type, checked against the magic bytes too. */
const ALLOWED_CONTENT_TYPES: Record<MediaType, string[]> = {
  PHOTO: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  SIGNATURE: ['image/png', 'image/jpeg', 'image/webp'],
  DOCUMENT: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  AUDIO: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'],
  VIDEO: ['video/mp4', 'video/webm'],
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Evidence: photos, documents, audio, video, signatures.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  THE DATABASE HOLDS METADATA; THE BYTES LIVE IN OBJECT STORAGE. Nothing here
 *  writes a blob to Postgres.
 *
 *  THE UPLOAD IS TWO-PHASE, and the order matters:
 *
 *    1. `requestUpload` writes the row in PENDING_UPLOAD and hands back a
 *       presigned PUT URL. The client uploads straight to the bucket.
 *    2. `confirmUpload` verifies the object is actually there and flips the row
 *       to UPLOADED.
 *
 *  Writing the row first is what makes an abandoned upload *visible* — a row
 *  stuck in PENDING_UPLOAD is a known unfinished thing that a sweep can clean
 *  up, whereas an object with no row is a file nobody can find or account for.
 *  And a 20 MB site video never occupies a Node process for the length of its
 *  transfer.
 *
 *  Where presigning is unavailable (the local development driver),
 *  `uploadDirect` takes the bytes through the API instead. Same rows, same
 *  checks, slower — an honest fallback rather than a pretend presigned URL.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Upload
  // ─────────────────────────────────────────────────────────────────────────

  async requestUpload(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    dto: RequestUploadDto,
  ) {
    await this.assertCanAttach(tenantId, principal, dto.investigationId);
    this.assertContentType(dto.mediaType, dto.contentType);

    if (dto.sizeBytes > this.storage.maxUploadBytes) {
      throw new BadRequestException(
        `حجم الملف يتجاوز ${Math.round(this.storage.maxUploadBytes / 1024 / 1024)} ميجابايت - ` +
          `The file exceeds ${Math.round(this.storage.maxUploadBytes / 1024 / 1024)} MB`,
      );
    }

    const categoryId = await this.resolveCategory(
      tenantId,
      dto.categoryCode,
      dto.mediaType,
    );

    if (!this.storage.supportsPresignedUploads) {
      throw new BadRequestException({
        message:
          'التخزين الحالي لا يدعم الرفع المباشر، استخدم /media/upload - ' +
          'The configured storage driver cannot issue presigned URLs; use POST /media/upload instead',
        errorCode: 'PRESIGN_UNSUPPORTED',
      });
    }

    const presigned = await this.storage.presignUpload({
      tenantId,
      prefix: 'media',
      fileName: safeFileName(dto.fileName),
      contentType: dto.contentType,
      contentLength: dto.sizeBytes,
    });

    const asset = await this.prisma.mediaAsset.create({
      data: {
        tenantId,
        investigationId: dto.investigationId,
        customerId: dto.customerId,
        categoryId,
        mediaType: dto.mediaType,
        status: MediaStatus.PENDING_UPLOAD,
        storageKey: presigned.key,
        fileName: safeFileName(dto.fileName),
        mimeType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        checksum: dto.checksum,
        capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : undefined,
        captureLat: dto.captureLat,
        captureLng: dto.captureLng,
        captureAccuracy: dto.captureAccuracy,
        caption: dto.caption,
        uploadedByType: principal.principalType,
        uploadedById:
          principal.principalType === PrincipalType.WEB_USER
            ? principal.id
            : null,
      },
      select: { id: true, storageKey: true, status: true },
    });

    return {
      assetId: asset.id,
      uploadUrl: presigned.url,
      method: presigned.method,
      expiresIn: presigned.expiresIn,
      headers: { 'Content-Type': dto.contentType },
    };
  }

  /**
   * Confirm the object landed.
   *
   * Checks the bucket rather than believing the client: a row marked UPLOADED
   * because a client said so, with nothing behind it, is a case that looks
   * complete and has no evidence.
   */
  async confirmUpload(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    assetId: string,
    dto: ConfirmUploadDto,
  ) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, id: assetId },
    });
    if (!asset) {
      throw new NotFoundException('المرفق غير موجود - Attachment not found');
    }

    const head = await this.storage.headObject(tenantId, asset.storageKey);
    if (!head.exists) {
      throw new BadRequestException(
        'لم يتم العثور على الملف في التخزين - ' +
          'The file was not found in storage; the upload did not complete',
      );
    }

    const updated = await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: MediaStatus.UPLOADED,
        sizeBytes: head.size ?? asset.sizeBytes,
        width: dto.width,
        height: dto.height,
        durationSec: dto.durationSec,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'FILE_UPLOADED',
      category: 'MEDIA',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      entityType: 'MediaAsset',
      entityId: assetId,
      entityLabel: asset.fileName,
      metadata: {
        investigationId: asset.investigationId,
        mediaType: asset.mediaType,
        sizeBytes: head.size,
      },
    });

    return updated;
  }

  /**
   * Upload through the API.
   *
   * Used by the web client for small files and by any deployment on the local
   * storage driver. This is where the magic-byte check happens — the presigned
   * path cannot see the bytes, which is the trade for not proxying them.
   */
  async uploadDirect(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    file: Express.Multer.File,
    dto: RequestUploadDto,
  ) {
    await this.assertCanAttach(tenantId, principal, dto.investigationId);
    this.assertContentType(dto.mediaType, file.mimetype);
    // Multipart names arrive Latin-1-decoded; see file-name.util.ts.
    const fileName = safeFileName(file.originalname);

    // `file.mimetype` is a client-supplied header. The bytes are the only
    // statement about what this actually is.
    const { ok, detected } = isAcceptableFor(dto.mediaType, file.buffer);
    if (!ok) {
      throw new BadRequestException(
        `محتوى الملف (${detected}) لا يطابق النوع المطلوب (${dto.mediaType}) - ` +
          `The file contents (${detected}) do not match the declared type (${dto.mediaType})`,
      );
    }

    if (file.size > this.storage.maxUploadBytes) {
      throw new BadRequestException(
        `حجم الملف يتجاوز الحد المسموح - The file exceeds the size limit`,
      );
    }

    const categoryId = await this.resolveCategory(
      tenantId,
      dto.categoryCode,
      dto.mediaType,
    );

    const stored = await this.storage.putObject({
      tenantId,
      prefix: 'media',
      fileName: fileName,
      contentType: file.mimetype,
      body: file.buffer,
    });

    // Computed here rather than trusted from the client, so a file resubmitted
    // under a new name is detectable.
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    const asset = await this.prisma.mediaAsset.create({
      data: {
        tenantId,
        investigationId: dto.investigationId,
        customerId: dto.customerId,
        categoryId,
        mediaType: dto.mediaType,
        status: MediaStatus.UPLOADED,
        storageKey: stored.key,
        fileName: fileName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
        capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : undefined,
        captureLat: dto.captureLat,
        captureLng: dto.captureLng,
        captureAccuracy: dto.captureAccuracy,
        caption: dto.caption,
        uploadedByType: principal.principalType,
        uploadedById:
          principal.principalType === PrincipalType.WEB_USER
            ? principal.id
            : null,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'FILE_UPLOADED',
      category: 'MEDIA',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      entityType: 'MediaAsset',
      entityId: asset.id,
      entityLabel: fileName,
      metadata: {
        investigationId: dto.investigationId,
        mediaType: dto.mediaType,
        sizeBytes: file.size,
      },
    });

    return asset;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, query: MediaQueryDto) {
    const where: Prisma.MediaAssetWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.investigationId
        ? { investigationId: query.investigationId }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.mediaType ? { mediaType: query.mediaType } : {}),
      ...(query.categoryCode ? { category: { code: query.categoryCode } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where,
        include: {
          category: {
            select: { id: true, code: true, nameAr: true, nameEn: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toDto(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
        hasNext: query.page * query.limit < total,
        hasPrev: query.page > 1,
      },
    };
  }

  /**
   * A short-lived download URL, and an audit row saying who asked for it.
   *
   * The audit entry is the point: these are photographs of people's homes and
   * copies of their identity documents. Who looked, and when, is part of the
   * record.
   */
  async downloadUrl(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    assetId: string,
    /** Viewing in place rather than downloading; honoured only for safe types. */
    inline = false,
  ) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, id: assetId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException('المرفق غير موجود - Attachment not found');
    }

    // An investigator may only fetch evidence from a case that is currently
    // theirs — the same rule as reading the case itself.
    if (principal.principalType === PrincipalType.INVESTIGATOR) {
      const own = await this.prisma.investigation.findFirst({
        where: {
          tenantId,
          id: asset.investigationId ?? '',
          investigatorId: principal.id,
        },
        select: { id: true },
      });
      if (!own) {
        throw new NotFoundException('المرفق غير موجود - Attachment not found');
      }
    }

    await this.audit.log({
      tenantId,
      action: inline ? 'FILE_VIEWED' : 'FILE_DOWNLOADED',
      category: 'MEDIA',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      entityType: 'MediaAsset',
      entityId: assetId,
      entityLabel: asset.fileName,
    });

    if (!this.storage.supportsPresignedUploads) {
      // The local driver cannot sign; the controller streams instead.
      return {
        url: null,
        streamThroughApi: true,
        expiresIn: 0,
        mimeType: asset.mimeType,
      };
    }

    const { url, expiresIn } = await this.storage.presignDownload(
      tenantId,
      asset.storageKey,
      asset.fileName,
      inline && isViewable(asset.mimeType),
    );

    return {
      url,
      streamThroughApi: false,
      expiresIn,
      mimeType: asset.mimeType,
    };
  }

  /** The bytes, for the streaming fallback. */
  async readBytes(tenantId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, id: assetId, deletedAt: null },
      select: { storageKey: true, fileName: true, mimeType: true },
    });
    if (!asset) {
      throw new NotFoundException('المرفق غير موجود - Attachment not found');
    }

    return {
      buffer: await this.storage.getObject(tenantId, asset.storageKey),
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    };
  }

  /**
   * Soft delete.
   *
   * The object stays in the bucket. Evidence a QC officer rejected is part of
   * why they rejected it, and a hard delete would make that unauditable; the
   * retention sweep is the only thing that removes bytes.
   */
  async remove(
    tenantId: string,
    principal: AuthenticatedUser,
    assetId: string,
    reason?: string,
  ) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, id: assetId, deletedAt: null },
      select: {
        id: true,
        fileName: true,
        investigationId: true,
        investigation: { select: { status: true, caseNumber: true } },
      },
    });
    if (!asset) {
      throw new NotFoundException('المرفق غير موجود - Attachment not found');
    }

    // Once a case is approved its evidence is the basis of a delivered report.
    if (
      asset.investigation &&
      ['QC_APPROVED', 'REPORT_GENERATION', 'COMPLETED', 'ARCHIVED'].includes(
        asset.investigation.status,
      )
    ) {
      throw new BadRequestException(
        'لا يمكن حذف مرفقات تحقيق معتمد - ' +
          'Evidence on an approved case cannot be deleted',
      );
    }

    await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      action: 'FILE_DELETED',
      category: 'MEDIA',
      severity: 'WARNING',
      entityType: 'MediaAsset',
      entityId: assetId,
      entityLabel: asset.fileName,
      metadata: { investigationId: asset.investigationId, reason },
    });

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Categories
  // ─────────────────────────────────────────────────────────────────────────

  async listCategories(tenantId: string, activeOnly = false) {
    return this.prisma.mediaCategory.findMany({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
  }

  async upsertCategory(
    tenantId: string,
    dto: UpsertMediaCategoryDto,
    id?: string,
  ) {
    if (id) {
      const existing = await this.prisma.mediaCategory.findFirst({
        where: { tenantId, id },
      });
      if (!existing) {
        throw new NotFoundException('التصنيف غير موجود - Category not found');
      }
      return this.prisma.mediaCategory.update({
        where: { id },
        data: { ...dto, code: existing.code },
      });
    }

    const clash = await this.prisma.mediaCategory.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        'كود التصنيف مستخدم بالفعل - Category code is already in use',
      );
    }

    return this.prisma.mediaCategory.create({ data: { tenantId, ...dto } });
  }

  async removeCategory(tenantId: string, id: string) {
    const category = await this.prisma.mediaCategory.findFirst({
      where: { tenantId, id },
      include: { _count: { select: { assets: true } } },
    });
    if (!category) {
      throw new NotFoundException('التصنيف غير موجود - Category not found');
    }

    if (category._count.assets > 0) {
      await this.prisma.mediaCategory.update({
        where: { id },
        data: { isActive: false },
      });
      return { deleted: false, deactivated: true };
    }

    await this.prisma.mediaCategory.delete({ where: { id } });
    return { deleted: true, deactivated: false };
  }

  /**
   * Delete rows whose upload never completed.
   *
   * A PENDING_UPLOAD row older than a day is a client that crashed or a user
   * who closed the tab; leaving them makes every "how many photos does this
   * case have" answer wrong.
   */
  async prunePendingUploads(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
    const { count } = await this.prisma.mediaAsset.deleteMany({
      where: {
        status: MediaStatus.PENDING_UPLOAD,
        createdAt: { lt: cutoff },
      },
    });
    if (count > 0) {
      this.logger.log(`Pruned ${count} abandoned upload row(s)`);
    }
    return count;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Internals
  // ─────────────────────────────────────────────────────────────────────────

  private assertContentType(mediaType: MediaType, contentType: string): void {
    const allowed = ALLOWED_CONTENT_TYPES[mediaType] ?? [];
    if (!allowed.includes(contentType)) {
      throw new BadRequestException(
        `نوع المحتوى غير مسموح لـ ${mediaType} - ` +
          `Content type "${contentType}" is not allowed for ${mediaType}. ` +
          `Allowed: ${allowed.join(', ')}`,
      );
    }
  }

  private async resolveCategory(
    tenantId: string,
    code: string | undefined,
    mediaType: MediaType,
  ): Promise<string | undefined> {
    if (!code) return undefined;

    const category = await this.prisma.mediaCategory.findFirst({
      where: { tenantId, code, isActive: true },
      select: { id: true, mediaType: true },
    });

    if (!category) {
      throw new BadRequestException(
        `التصنيف "${code}" غير موجود - Category "${code}" was not found`,
      );
    }
    if (category.mediaType !== mediaType) {
      throw new BadRequestException(
        `التصنيف "${code}" مخصص لـ ${category.mediaType} - ` +
          `Category "${code}" is for ${category.mediaType}, not ${mediaType}`,
      );
    }

    return category.id;
  }

  /** A case an investigator may attach to must currently be theirs. */
  private async assertCanAttach(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    investigationId?: string,
  ): Promise<void> {
    if (!investigationId) return;

    const investigation = await this.prisma.investigation.findFirst({
      where: {
        tenantId,
        id: investigationId,
        deletedAt: null,
        ...(principal.principalType === PrincipalType.INVESTIGATOR
          ? { investigatorId: principal.id }
          : {}),
      },
      select: { id: true },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }
  }

  /** Decimals to numbers, and never the storage key. */
  private toDto(asset: Record<string, unknown>) {
    // Destructured out, never spread into the reply: the storage key is a
    // path into the bucket and belongs to the server alone.
    const { storageKey: _storageKey, ...safe } = asset;
    return {
      ...safe,
      // Names stored before the multipart fix are repaired on the way out.
      ...(typeof safe.fileName === 'string'
        ? { fileName: decodeUploadName(safe.fileName) }
        : {}),
      captureLat: safe.captureLat ? Number(safe.captureLat) : null,
      captureLng: safe.captureLng ? Number(safe.captureLng) : null,
      captureAccuracy: safe.captureAccuracy
        ? Number(safe.captureAccuracy)
        : null,
    };
  }
}
