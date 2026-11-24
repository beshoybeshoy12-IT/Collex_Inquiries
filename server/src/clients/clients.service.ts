import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { sniffSignature } from '../common/utils/file-signature.util';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import {
  buildClientTemplateWorkbook,
  codeFrom,
  normaliseTemplateFields,
  readTemplate,
} from './clients.util';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Raster only — an SVG logo is a document that can carry script. */
const LOGO_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const LOGO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const SELECT = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  contactEmail: true,
  contactPhone: true,
  logoKey: true,
  templateFields: true,
  productIds: true,
  investigationTypeIds: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      investigations: { where: { deletedAt: null } },
      importBatches: true,
    },
  },
} satisfies Prisma.ClientAccountSelect;

type ClientRow = Prisma.ClientAccountGetPayload<{ select: typeof SELECT }>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Clients ("الجهات") — the banks and companies inquiries are done for.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Each client carries its own inquiry template: the columns of the file it
 *  sends, in its order and under its names. Downloading the template gives
 *  the client a blank file in exactly that shape; uploading into the client
 *  maps the columns without asking, and every case created belongs to it.
 *
 *  The logo is stored like a profile photo — a key in storage, served back
 *  through the API with the caller's token — and printed on the client's
 *  inquiry forms.
 */
@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeInactive = false) {
    const rows = await this.prisma.clientAccount.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      select: SELECT,
      orderBy: [{ isActive: 'desc' }, { nameAr: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(tenantId: string, id: string) {
    return toDto(await this.load(tenantId, id));
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    dto: CreateClientDto,
  ) {
    const lists = await this.checkLists(tenantId, dto);
    const templateFields = normaliseTemplateFields(dto.templateFields ?? []);
    const code = await this.uniqueCode(tenantId, codeFrom(dto.nameEn));

    const created = await this.prisma.clientAccount.create({
      data: {
        tenantId,
        code,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        contactEmail: dto.contactEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        productIds: lists.productIds ?? [],
        investigationTypeIds: lists.investigationTypeIds ?? [],
        templateFields: templateFields as unknown as Prisma.InputJsonValue,
      },
      select: SELECT,
    });

    await this.log(user, 'CLIENT_CREATED', created, {
      nameAr: created.nameAr,
      nameEn: created.nameEn,
      fields: templateFields.length,
    });
    return toDto(created);
  }

  async update(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
    dto: UpdateClientDto,
  ) {
    const before = await this.load(tenantId, id);
    const lists = await this.checkLists(tenantId, dto);

    const data: Prisma.ClientAccountUpdateInput = {};
    if (dto.nameAr !== undefined) data.nameAr = dto.nameAr;
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (lists.productIds) data.productIds = lists.productIds;
    if (lists.investigationTypeIds) {
      data.investigationTypeIds = lists.investigationTypeIds;
    }
    if (dto.templateFields !== undefined) {
      data.templateFields = normaliseTemplateFields(
        dto.templateFields,
      ) as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.clientAccount.update({
      where: { id },
      data,
      select: SELECT,
    });

    const changed: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    for (const key of ['nameAr', 'nameEn', 'isActive'] as const) {
      if (before[key] !== updated[key]) {
        previous[key] = before[key];
        changed[key] = updated[key];
      }
    }
    if (dto.templateFields !== undefined) {
      changed.templateFields = readTemplate(updated.templateFields).length;
    }
    await this.log(user, 'CLIENT_UPDATED', updated, changed, previous);
    return toDto(updated);
  }

  // ── Logo ────────────────────────────────────────────────────────────────

  async readLogo(tenantId: string, id: string) {
    const client = await this.load(tenantId, id);
    if (!client.logoKey) throw new NotFoundException('لا يوجد شعار - No logo');

    const buffer = await this.storage.getObject(tenantId, client.logoKey);
    // Re-sniffed on the way out: the Content-Type is what the bytes are.
    const contentType = LOGO_TYPES[sniffSignature(buffer)];
    if (!contentType) throw new NotFoundException('لا يوجد شعار - No logo');
    return { buffer, contentType };
  }

  async uploadLogo(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
    file: Express.Multer.File | undefined,
  ) {
    const client = await this.load(tenantId, id);

    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'لم يتم إرفاق صورة - No image was attached',
      );
    }
    if (file.size > LOGO_MAX_BYTES) {
      throw new BadRequestException(
        'حجم الشعار يتجاوز 2 ميجابايت - The logo is larger than 2 MB',
      );
    }
    const contentType = LOGO_TYPES[sniffSignature(file.buffer)];
    if (!contentType) {
      throw new BadRequestException({
        message:
          'نوع الملف غير مدعوم؛ استخدم PNG أو JPG أو WebP - ' +
          'Unsupported file type; use PNG, JPG or WebP',
        errorCode: 'UNSUPPORTED_IMAGE',
      });
    }

    const stored = await this.storage.putObject({
      tenantId,
      prefix: 'clients',
      fileName: `${client.code.toLowerCase()}-logo${LOGO_EXTENSION[contentType]}`,
      body: file.buffer,
      contentType,
    });

    const updated = await this.prisma.clientAccount.update({
      where: { id },
      data: { logoKey: stored.key },
      select: SELECT,
    });
    if (client.logoKey) await this.removeObject(tenantId, client.logoKey);

    await this.log(user, 'CLIENT_LOGO_UPDATED', updated, {});
    return toDto(updated);
  }

  async removeLogo(tenantId: string, user: AuthenticatedUser, id: string) {
    const client = await this.load(tenantId, id);
    if (!client.logoKey) return toDto(client);

    const updated = await this.prisma.clientAccount.update({
      where: { id },
      data: { logoKey: null },
      select: SELECT,
    });
    await this.removeObject(tenantId, client.logoKey);
    await this.log(user, 'CLIENT_LOGO_REMOVED', updated, {});
    return toDto(updated);
  }

  // ── Template ────────────────────────────────────────────────────────────

  /** The client's blank inquiry file, named after it in the caller's language. */
  async template(tenantId: string, id: string, language: 'ar' | 'en') {
    const client = await this.load(tenantId, id);
    const fields = readTemplate(client.templateFields);
    if (fields.length === 0) {
      throw new BadRequestException(
        'لم تُحدَّد حقول قالب لهذه الجهة بعد - This client has no template fields yet',
      );
    }
    const name = language === 'en' ? client.nameEn : client.nameAr;
    return {
      buffer: buildClientTemplateWorkbook(fields, {
        rtl: language === 'ar',
        sheetName: name,
      }),
      fileName:
        language === 'en' ? `${name} template.xlsx` : `قالب ${name}.xlsx`,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async load(tenantId: string, id: string): Promise<ClientRow> {
    const client = await this.prisma.clientAccount.findFirst({
      where: { tenantId, id },
      select: SELECT,
    });
    if (!client)
      throw new NotFoundException('الجهة غير موجودة - Client not found');
    return client;
  }

  /**
   * The allowed products and types, de-duplicated, and every one of them this
   * tenant's own and active. Returns undefined for a list not being changed.
   */
  private async checkLists(
    tenantId: string,
    dto: { productIds?: string[]; investigationTypeIds?: string[] },
  ) {
    const productIds = dto.productIds
      ? [...new Set(dto.productIds)]
      : undefined;
    const investigationTypeIds = dto.investigationTypeIds
      ? [...new Set(dto.investigationTypeIds)]
      : undefined;

    if (productIds?.length) {
      const found = await this.prisma.product.count({
        where: { tenantId, id: { in: productIds }, isActive: true },
      });
      if (found !== productIds.length) {
        throw new BadRequestException('منتج غير موجود - Product not found');
      }
    }
    if (investigationTypeIds?.length) {
      const found = await this.prisma.investigationType.count({
        where: { tenantId, id: { in: investigationTypeIds }, isActive: true },
      });
      if (found !== investigationTypeIds.length) {
        throw new BadRequestException(
          'نوع استعلام غير موجود - Investigation type not found',
        );
      }
    }
    return { productIds, investigationTypeIds };
  }

  private async uniqueCode(tenantId: string, base: string): Promise<string> {
    const taken = new Set(
      (
        await this.prisma.clientAccount.findMany({
          where: { tenantId, code: { startsWith: base } },
          select: { code: true },
        })
      ).map((row) => row.code),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}_${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private async removeObject(tenantId: string, key: string) {
    try {
      await this.storage.deleteObject(tenantId, key);
    } catch (error) {
      // An orphaned object costs bytes; a failed request costs the user.
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }

  private log(
    user: AuthenticatedUser,
    action: string,
    client: { id: string; nameEn: string },
    newValue: Record<string, unknown>,
    oldValue?: Record<string, unknown>,
  ) {
    return this.audit.log({
      tenantId: user.tenantId,
      action,
      category: 'SETTINGS',
      actorType: user.principalType,
      actorId: user.id,
      actorName: user.fullName,
      entityType: 'ClientAccount',
      entityId: client.id,
      entityLabel: client.nameEn,
      newValue,
      oldValue,
    });
  }
}

/** A token that changes whenever the logo does — the client caches on it. */
function versionOf(key: string | null): string | null {
  return key
    ? createHash('sha256').update(key).digest('hex').slice(0, 12)
    : null;
}

function toDto(row: ClientRow) {
  const { logoKey, _count, templateFields, ...rest } = row;
  return {
    ...rest,
    templateFields: readTemplate(templateFields),
    logoVersion: versionOf(logoKey),
    investigationCount: _count.investigations,
    importCount: _count.importBatches,
  };
}
