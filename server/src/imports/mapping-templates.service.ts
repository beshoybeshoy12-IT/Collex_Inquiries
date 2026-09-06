import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FIELD_BY_KEY } from './utils/field-catalog';
import {
  CreateMappingTemplateDto,
  UpdateMappingTemplateDto,
} from './dto/import.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * Saved column mappings, one per client format.
 *
 * This is what turns the second file from a bank into a one-click import: the
 * headers are stable per client and vary wildly between them, so the mapping is
 * a property of the client relationship rather than of the file.
 *
 * A template is validated against the field catalogue on save. Storing a
 * mapping that names a field this build does not have would produce an import
 * that silently drops a column months later, with nothing to point at.
 */
@Injectable()
export class MappingTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.importMappingTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { nameEn: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.prisma.importMappingTemplate.findFirst({
      where: { tenantId, id },
    });
    if (!template) {
      throw new NotFoundException(
        'قالب الربط غير موجود - Mapping template not found',
      );
    }
    return template;
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    dto: CreateMappingTemplateDto,
  ) {
    this.assertMappingIsValid(dto.mapping);

    const clash = await this.prisma.importMappingTemplate.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'كود القالب مستخدم بالفعل - Template code is already in use',
      );
    }

    const template = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        // Exactly one default, or "apply the default" is ambiguous.
        await tx.importMappingTemplate.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const { mapping, defaults, ...scalars } = dto;

      return tx.importMappingTemplate.create({
        data: {
          tenantId,
          ...scalars,
          mapping: mapping as never,
          defaults: (defaults ?? undefined) as never,
          createdById: user.id,
        },
      });
    });

    await this.audit.log({
      tenantId,
      action: 'IMPORT_MAPPING_CREATED',
      category: 'IMPORT',
      entityType: 'ImportMappingTemplate',
      entityId: template.id,
      entityLabel: template.code,
      newValue: { code: template.code, fields: Object.keys(dto.mapping) },
    });

    return template;
  }

  async update(tenantId: string, id: string, dto: UpdateMappingTemplateDto) {
    const existing = await this.findOne(tenantId, id);

    if (dto.mapping) this.assertMappingIsValid(dto.mapping);

    if (dto.code && dto.code !== existing.code) {
      throw new BadRequestException(
        'لا يمكن تغيير كود القالب - A template code cannot be changed',
      );
    }

    // `mapping` and `defaults` are JSON columns, so they are lifted out of the
    // spread and cast: Prisma's generated input type for a nullable JSON field
    // does not accept a plain `Record`.
    const { mapping, defaults, ...scalars } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.importMappingTemplate.updateMany({
          where: { tenantId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.importMappingTemplate.update({
        where: { id },
        data: {
          ...scalars,
          ...(mapping ? { mapping: mapping as never } : {}),
          ...(defaults ? { defaults: defaults as never } : {}),
        },
      });
    });

    await this.audit.log({
      tenantId,
      action: 'IMPORT_MAPPING_UPDATED',
      category: 'IMPORT',
      entityType: 'ImportMappingTemplate',
      entityId: id,
      entityLabel: existing.code,
    });

    return updated;
  }

  /**
   * Deactivate rather than delete when batches reference it.
   *
   * A batch stores the mapping it actually used in `mappingUsed`, so history is
   * safe either way — but the FK would still break, and a batch that cannot
   * name the template it came from is harder to explain than a deactivated row.
   */
  async remove(tenantId: string, id: string) {
    const template = await this.findOne(tenantId, id);

    const used = await this.prisma.importBatch.count({
      where: { tenantId, mappingTemplateId: id },
    });

    if (used > 0) {
      await this.prisma.importMappingTemplate.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        deleted: false,
        deactivated: true,
        message:
          `القالب مستخدم في ${used} دفعة، تم تعطيله - ` +
          `Used by ${used} batch(es); deactivated instead of deleted`,
      };
    }

    await this.prisma.importMappingTemplate.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      action: 'IMPORT_MAPPING_DELETED',
      category: 'IMPORT',
      severity: 'NOTICE',
      entityType: 'ImportMappingTemplate',
      entityId: id,
      entityLabel: template.code,
    });

    return { deleted: true, deactivated: false };
  }

  /** Every key must name a real field, and no column may be claimed twice. */
  private assertMappingIsValid(mapping: Record<string, string>): void {
    const unknown = Object.keys(mapping).filter(
      (key) => !FIELD_BY_KEY.has(key),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `حقول غير معروفة: ${unknown.join(', ')} - Unknown fields: ${unknown.join(', ')}`,
      );
    }

    const columns = Object.values(mapping).filter(Boolean);
    const duplicates = columns.filter(
      (column, index) => columns.indexOf(column) !== index,
    );
    if (duplicates.length > 0) {
      throw new BadRequestException(
        `عمود مرتبط بأكثر من حقل: ${[...new Set(duplicates)].join(', ')} - ` +
          `A column is mapped to more than one field: ${[...new Set(duplicates)].join(', ')}`,
      );
    }
  }
}
