import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { validateFormSchema, FormSchema } from './form-schema';
import {
  CreateFormTemplateDto,
  SaveFormVersionDto,
  UpdateFormTemplateDto,
} from './dto/form.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Form templates and their versions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  THE VERSIONING RULE, AND WHY IT IS ABSOLUTE:
 *
 *    A PUBLISHED VERSION IS IMMUTABLE.
 *
 *  Editing one is refused — the builder clones it into a new draft instead.
 *  This is not fussiness. An investigation from eighteen months ago stores its
 *  answers against `formVersionId`; if that version's schema could change, the
 *  answers would be reinterpreted against questions that were never asked, and
 *  a report regenerated for a dispute would show a different form from the one
 *  the investigator filled in. That is evidence quietly rewriting itself.
 *
 *  Assignment pins `Investigation.formVersionId` to the template's currently
 *  published version, so publishing v3 affects only cases assigned from that
 *  moment on. Cases already in the field keep v2 until they finish.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Templates
  // ─────────────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, activeOnly = false) {
    return this.prisma.formTemplate.findMany({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      include: {
        versions: {
          select: {
            id: true,
            version: true,
            isPublished: true,
            publishedAt: true,
            changeNote: true,
            createdAt: true,
          },
          orderBy: { version: 'desc' },
        },
        investigationTypes: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
      orderBy: { nameEn: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: { tenantId, id },
      include: {
        versions: { orderBy: { version: 'desc' } },
        investigationTypes: {
          select: { id: true, code: true, nameAr: true, nameEn: true },
        },
      },
    });
    if (!template) {
      throw new NotFoundException(
        'النموذج غير موجود - Form template not found',
      );
    }
    return template;
  }

  /** The version a new assignment would pin — what the mobile client fetches. */
  async publishedVersion(tenantId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: { tenantId, id: templateId },
      select: {
        publishedVersionId: true,
        code: true,
        nameAr: true,
        nameEn: true,
      },
    });

    if (!template) {
      throw new NotFoundException(
        'النموذج غير موجود - Form template not found',
      );
    }
    if (!template.publishedVersionId) {
      throw new NotFoundException(
        'لا يوجد إصدار منشور لهذا النموذج - This form has no published version',
      );
    }

    return this.prisma.formVersion.findUniqueOrThrow({
      where: { id: template.publishedVersionId },
    });
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    dto: CreateFormTemplateDto,
  ) {
    const clash = await this.prisma.formTemplate.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'كود النموذج مستخدم بالفعل - Form code is already in use',
      );
    }

    // A template is created with an empty draft v1 rather than with nothing:
    // the builder always has something to open, and "create then separately
    // create a version" is a two-step nobody remembers.
    const template = await this.prisma.formTemplate.create({
      data: {
        tenantId,
        code: dto.code,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        description: dto.description,
        versions: {
          create: {
            tenantId,
            version: 1,
            isPublished: false,
            schema: (dto.schema ?? { sections: [] }) as never,
            createdById: user.id,
          },
        },
      },
      include: { versions: true },
    });

    await this.audit.log({
      tenantId,
      action: 'FORM_CREATED',
      category: 'FORM',
      entityType: 'FormTemplate',
      entityId: template.id,
      entityLabel: template.code,
    });

    return template;
  }

  async update(tenantId: string, id: string, dto: UpdateFormTemplateDto) {
    const existing = await this.findOne(tenantId, id);

    if (dto.code && dto.code !== existing.code) {
      throw new BadRequestException(
        'لا يمكن تغيير كود النموذج - A form code cannot be changed',
      );
    }

    const updated = await this.prisma.formTemplate.update({
      where: { id },
      data: {
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        description: dto.description,
        isActive: dto.isActive,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'FORM_UPDATED',
      category: 'FORM',
      entityType: 'FormTemplate',
      entityId: id,
      entityLabel: existing.code,
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Versions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save the working draft.
   *
   * Refused on a published version — the caller is told to clone instead, and
   * `createDraft` below is the one click that does it.
   */
  async saveDraft(
    tenantId: string,
    templateId: string,
    versionId: string,
    dto: SaveFormVersionDto,
  ) {
    const version = await this.prisma.formVersion.findFirst({
      where: { tenantId, id: versionId, templateId },
    });

    if (!version) {
      throw new NotFoundException('الإصدار غير موجود - Form version not found');
    }

    if (version.isPublished) {
      throw new BadRequestException({
        message:
          'لا يمكن تعديل إصدار منشور، أنشئ إصدارًا جديدًا - ' +
          'A published version cannot be edited; create a new version instead',
        errorCode: 'FORM_VERSION_PUBLISHED',
      });
    }

    // Validated on save as well as on publish, so the builder reports problems
    // while the author is still looking at the field that caused them.
    validateFormSchema(dto.schema);

    return this.prisma.formVersion.update({
      where: { id: versionId },
      data: {
        schema: dto.schema as never,
        changeNote: dto.changeNote,
      },
    });
  }

  /** Clone the newest version into a new editable draft. */
  async createDraft(
    tenantId: string,
    templateId: string,
    user: AuthenticatedUser,
    fromVersionId?: string,
  ) {
    const template = await this.findOne(tenantId, templateId);

    const existingDraft = template.versions.find((v) => !v.isPublished);
    if (existingDraft) {
      throw new ConflictException({
        message:
          `يوجد إصدار مسودة بالفعل (v${existingDraft.version}) - ` +
          `A draft already exists (v${existingDraft.version})`,
        errorCode: 'DRAFT_EXISTS',
        draftId: existingDraft.id,
      });
    }

    const source = fromVersionId
      ? template.versions.find((v) => v.id === fromVersionId)
      : (template.versions.find((v) => v.id === template.publishedVersionId) ??
        template.versions[0]);

    if (!source) {
      throw new NotFoundException(
        'لا يوجد إصدار لنسخه - There is no version to copy from',
      );
    }

    const nextVersion =
      Math.max(...template.versions.map((v) => v.version), 0) + 1;

    const draft = await this.prisma.formVersion.create({
      data: {
        tenantId,
        templateId,
        version: nextVersion,
        isPublished: false,
        schema: source.schema as never,
        changeNote: `Copied from v${source.version}`,
        createdById: user.id,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'FORM_DRAFT_CREATED',
      category: 'FORM',
      entityType: 'FormVersion',
      entityId: draft.id,
      entityLabel: `${template.code} v${nextVersion}`,
      metadata: { copiedFrom: source.version },
    });

    return draft;
  }

  /**
   * Publish a draft.
   *
   * From here the schema is frozen and the template points at it. The previous
   * published version stays exactly as it was — it is still the version every
   * case assigned under it is answering.
   */
  async publish(tenantId: string, templateId: string, versionId: string) {
    const template = await this.findOne(tenantId, templateId);
    const version = template.versions.find((v) => v.id === versionId);

    if (!version) {
      throw new NotFoundException('الإصدار غير موجود - Form version not found');
    }
    if (version.isPublished) {
      throw new BadRequestException(
        'الإصدار منشور بالفعل - This version is already published',
      );
    }

    const schema = validateFormSchema(version.schema);

    if (schema.sections.every((s) => s.fields.length === 0)) {
      throw new BadRequestException(
        'لا يمكن نشر نموذج بدون حقول - Cannot publish a form with no fields',
      );
    }

    const published = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.formVersion.update({
        where: { id: versionId },
        data: { isPublished: true, publishedAt: new Date() },
      });

      await tx.formTemplate.update({
        where: { id: templateId },
        data: { publishedVersionId: versionId },
      });

      return updated;
    });

    await this.audit.log({
      tenantId,
      action: 'FORM_PUBLISHED',
      category: 'FORM',
      severity: 'NOTICE',
      entityType: 'FormVersion',
      entityId: versionId,
      entityLabel: `${template.code} v${version.version}`,
      oldValue: { previousPublishedVersionId: template.publishedVersionId },
      newValue: { publishedVersionId: versionId },
    });

    return published;
  }

  /**
   * Delete a draft.
   *
   * Only a draft, and only one nothing points at. A published version is
   * historical evidence and there is no path here that removes one.
   */
  async removeDraft(tenantId: string, templateId: string, versionId: string) {
    const version = await this.prisma.formVersion.findFirst({
      where: { tenantId, id: versionId, templateId },
      include: {
        _count: { select: { submissions: true, investigations: true } },
      },
    });

    if (!version) {
      throw new NotFoundException('الإصدار غير موجود - Form version not found');
    }
    if (version.isPublished) {
      throw new BadRequestException(
        'لا يمكن حذف إصدار منشور - A published version cannot be deleted',
      );
    }
    if (version._count.submissions > 0 || version._count.investigations > 0) {
      throw new BadRequestException(
        'الإصدار مستخدم في تحقيقات قائمة - This version is in use by existing cases',
      );
    }

    await this.prisma.formVersion.delete({ where: { id: versionId } });
    return { success: true };
  }

  /**
   * The schema a specific case is answering.
   *
   * Reads `Investigation.formVersionId` — the pin — rather than the template's
   * current published version, which is the whole point of pinning it.
   */
  async schemaForInvestigation(
    tenantId: string,
    investigationId: string,
  ): Promise<{ versionId: string; version: number; schema: FormSchema }> {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: investigationId },
      select: {
        formVersionId: true,
        formVersion: { select: { id: true, version: true, schema: true } },
        investigationType: {
          select: {
            formTemplate: {
              select: {
                publishedVersionId: true,
              },
            },
          },
        },
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    if (investigation.formVersion) {
      return {
        versionId: investigation.formVersion.id,
        version: investigation.formVersion.version,
        schema: investigation.formVersion.schema as unknown as FormSchema,
      };
    }

    // A case created before its type had a form, or assigned when nothing was
    // published. Fall back to the current published version rather than failing
    // — the investigator standing at the door needs a form.
    const fallbackId =
      investigation.investigationType.formTemplate?.publishedVersionId;

    if (!fallbackId) {
      throw new NotFoundException(
        'لا يوجد نموذج مرتبط بهذا التحقيق - No form is configured for this case',
      );
    }

    const fallback = await this.prisma.formVersion.findUniqueOrThrow({
      where: { id: fallbackId },
    });

    return {
      versionId: fallback.id,
      version: fallback.version,
      schema: fallback.schema as unknown as FormSchema,
    };
  }
}
