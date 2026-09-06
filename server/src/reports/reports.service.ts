import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestigationStatus,
  MediaType,
  Prisma,
  ReportLocale,
  ReportStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { ReportRendererService } from './report-renderer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvestigationsService } from '../investigations/investigations.service';
import { RequestContextService } from '../common/context/request-context';
import { FormSchema, isVisible } from '../forms/form-schema';
import { QUEUES, JOBS, GenerateReportJob } from '../queue/queue.constants';
import { env } from '../common/config/env';
import {
  DEFAULT_REPORT_BODY,
  DEFAULT_REPORT_CSS,
} from './report-template.default';
import { GenerateReportDto } from './dto/report.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * What the template is rendered against, and what is stored as the snapshot.
 *
 * Typed loosely on purpose — a report template is editable by tenants and may
 * reference anything in here — but the few fields this service itself reads are
 * named, so a rename inside `buildSnapshot` is a compile error rather than an
 * `undefined` appearing in a generated filename.
 */
export interface ReportSnapshot extends Record<string, unknown> {
  investigation: { caseNumber: string; id: string };
}

/** How many photographs are embedded. Beyond this the PDF becomes unusable. */
const MAX_EMBEDDED_PHOTOS = 12;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Report generation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ALWAYS ASYNCHRONOUS. `request` writes a QUEUED row and returns immediately;
 *  the worker renders. A report with a dozen embedded photographs takes tens of
 *  seconds in Chromium, and doing that inside an HTTP request means a timeout
 *  for the user and a blocked event loop for everybody else.
 *
 *  VERSIONS ARE NEVER OVERWRITTEN. Regenerating produces v2 beside v1. A
 *  delivered report is a document somebody has acted on; replacing its contents
 *  at the same identifier is how a dispute becomes unresolvable.
 *
 *  THE SNAPSHOT IS THE POINT. Every report stores the exact data it was
 *  rendered from. Two years later the case has moved on, the customer's address
 *  has been corrected and the form template is on v5 — and the report can still
 *  explain itself, because it does not depend on any of them.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly renderer: ReportRendererService,
    private readonly notifications: NotificationsService,
    private readonly investigations: InvestigationsService,
    private readonly requestContext: RequestContextService,
  ) {
    // Inline mode has no worker, so the same handler is registered here and
    // runs in-process. Same code either way — see QueueService.
    this.queue.registerInlineHandler(JOBS.GENERATE_REPORT, (payload) =>
      this.generate(payload as GenerateReportJob),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Request
  // ─────────────────────────────────────────────────────────────────────────

  async request(
    tenantId: string,
    user: AuthenticatedUser,
    investigationId: string,
    dto: GenerateReportDto,
  ) {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: investigationId, deletedAt: null },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        productId: true,
        investigationTypeId: true,
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    // A report before QC has signed off would be a document asserting findings
    // nobody has checked.
    const reportable: InvestigationStatus[] = [
      InvestigationStatus.QC_APPROVED,
      InvestigationStatus.REPORT_GENERATION,
      InvestigationStatus.COMPLETED,
      InvestigationStatus.ARCHIVED,
    ];
    if (!reportable.includes(investigation.status)) {
      throw new BadRequestException(
        `لا يمكن إنشاء تقرير لتحقيق في حالة ${investigation.status} - ` +
          `A report cannot be generated for a case in status ${investigation.status}`,
      );
    }

    const templateId = await this.resolveTemplateId(
      tenantId,
      investigation.investigationTypeId,
      investigation.productId,
      dto.templateId,
    );

    const last = await this.prisma.report.aggregate({
      where: { tenantId, investigationId },
      _max: { version: true },
    });

    const report = await this.prisma.report.create({
      data: {
        tenantId,
        investigationId,
        templateId,
        version: (last._max.version ?? 0) + 1,
        status: ReportStatus.QUEUED,
        locale: dto.locale ?? ReportLocale.AR,
        isFinal: dto.isFinal ?? false,
        requestedById: user.id,
      },
    });

    const jobId = await this.queue.enqueue<GenerateReportJob>(
      QUEUES.REPORTS,
      JOBS.GENERATE_REPORT,
      {
        tenantId,
        reportId: report.id,
        investigationId,
        requestedById: user.id,
      },
    );

    if (jobId) {
      await this.prisma.report.update({
        where: { id: report.id },
        data: { jobId },
      });
    }

    // Move the case into REPORT_GENERATION so the list shows what is happening.
    if (investigation.status === InvestigationStatus.QC_APPROVED) {
      await this.investigations
        .systemTransition(
          tenantId,
          investigationId,
          InvestigationStatus.REPORT_GENERATION,
          'Report generation requested',
        )
        .catch((error) =>
          this.logger.warn(
            `Could not move ${investigation.caseNumber} to REPORT_GENERATION: ${String(error)}`,
          ),
        );
    }

    await this.audit.log({
      tenantId,
      action: 'REPORT_REQUESTED',
      category: 'REPORT',
      entityType: 'Report',
      entityId: report.id,
      entityLabel: `${investigation.caseNumber} v${report.version}`,
    });

    return {
      report,
      // In inline mode the render has already happened by the time we get here.
      queued: !this.queue.isInline,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Generate — this is what the worker runs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render and store one report.
   *
   * Runs on the worker with no request context, so it opens its own scoped
   * one — otherwise the tenant guard refuses every query, which is exactly the
   * behaviour that catches an unscoped background job.
   */
  async generate(job: GenerateReportJob): Promise<{ storageKey: string }> {
    return this.requestContext.runAsTenant(
      job.tenantId,
      async () => {
        const started = Date.now();

        await this.prisma.report.update({
          where: { id: job.reportId },
          data: { status: ReportStatus.GENERATING },
        });

        try {
          const snapshot = await this.buildSnapshot(
            job.tenantId,
            job.investigationId,
            job.reportId,
          );

          const report = await this.prisma.report.findUniqueOrThrow({
            where: { id: job.reportId },
            include: { template: true },
          });

          const template = report.template;
          const bodySource = template?.bodyHtml || DEFAULT_REPORT_BODY;
          const css = template?.css || DEFAULT_REPORT_CSS;

          const html = this.renderer.buildDocument(
            this.renderer.compile(bodySource, snapshot),
            css,
            report.locale === ReportLocale.EN ? 'en' : 'ar',
          );

          const { buffer, pageCount } = await this.renderer.renderPdf(html, {
            pageSize: template?.pageSize ?? 'A4',
            margins: (template?.marginsMm as never) ?? undefined,
            headerHtml: template?.headerHtml ?? undefined,
            footerHtml: template?.footerHtml ?? undefined,
          });

          const fileName = `${snapshot.investigation.caseNumber}-report-v${report.version}.pdf`;

          const stored = await this.storage.putObject({
            tenantId: job.tenantId,
            prefix: 'reports',
            fileName,
            contentType: 'application/pdf',
            body: buffer,
          });

          await this.prisma.report.update({
            where: { id: job.reportId },
            data: {
              status: ReportStatus.READY,
              storageKey: stored.key,
              fileName,
              sizeBytes: buffer.length,
              checksum: createHash('sha256').update(buffer).digest('hex'),
              pageCount,
              snapshot: snapshot as never,
              generatedAt: new Date(),
              error: null,
            },
          });

          // A final report closes the case. A draft does not — a coordinator
          // may generate several before deciding which to deliver.
          if (report.isFinal) {
            await this.investigations
              .systemTransition(
                job.tenantId,
                job.investigationId,
                InvestigationStatus.COMPLETED,
                'Final report generated',
              )
              .catch(() => undefined);
          }

          if (job.requestedById) {
            await this.notifications.notifyUser(
              job.tenantId,
              job.requestedById,
              {
                type: 'REPORT_READY',
                titleAr: 'التقرير جاهز',
                titleEn: 'Report ready',
                bodyAr: `تقرير التحقيق ${snapshot.investigation.caseNumber} جاهز للتحميل`,
                bodyEn: `The report for ${snapshot.investigation.caseNumber} is ready to download`,
                entityType: 'Report',
                entityId: job.reportId,
                link: `/investigations/${job.investigationId}?tab=report`,
              },
            );
          }

          await this.audit.log({
            tenantId: job.tenantId,
            action: 'REPORT_GENERATED',
            category: 'REPORT',
            actorName: 'system',
            entityType: 'Report',
            entityId: job.reportId,
            entityLabel: fileName,
            metadata: {
              sizeBytes: buffer.length,
              pageCount,
              durationMs: Date.now() - started,
            },
          });

          this.logger.log(
            `Generated ${fileName} (${Math.round(buffer.length / 1024)} kB) in ${Date.now() - started} ms`,
          );

          return { storageKey: stored.key };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          await this.prisma.report.update({
            where: { id: job.reportId },
            data: {
              status: ReportStatus.FAILED,
              error: message.slice(0, 1000),
            },
          });

          // Put the case back where it was so it is not stuck in
          // REPORT_GENERATION with nothing coming.
          await this.investigations
            .systemTransition(
              job.tenantId,
              job.investigationId,
              InvestigationStatus.QC_APPROVED,
              `Report generation failed: ${message.slice(0, 200)}`,
            )
            .catch(() => undefined);

          this.logger.error(`Report ${job.reportId} failed: ${message}`);
          throw error;
        }
      },
      'report-worker',
    );
  }

  /**
   * Assemble everything the template needs, with images already inlined.
   *
   * This is also what gets stored as the report's snapshot — one object, built
   * once, so the stored explanation is exactly what was rendered rather than a
   * separate summary that might not match.
   */
  private async buildSnapshot(
    tenantId: string,
    investigationId: string,
    reportId: string,
  ): Promise<ReportSnapshot> {
    const investigation = await this.prisma.investigation.findFirstOrThrow({
      where: { tenantId, id: investigationId },
      include: {
        customer: true,
        product: true,
        investigationType: true,
        governorate: true,
        city: true,
        district: true,
        area: true,
        investigator: {
          select: { id: true, fullName: true, employeeCode: true, phone: true },
        },
        coordinator: { select: { id: true, fullName: true } },
        tenant: {
          select: {
            nameAr: true,
            nameEn: true,
            logoUrl: true,
            phone: true,
            email: true,
            addressLine: true,
            taxId: true,
          },
        },
      },
    });

    const [submission, qcReview, media, gpsEvents, report] = await Promise.all([
      this.prisma.formSubmission.findFirst({
        where: { tenantId, investigationId, status: { not: 'DRAFT' } },
        orderBy: { attempt: 'desc' },
        include: { formVersion: true },
      }),
      this.prisma.qcReview.findFirst({
        where: { tenantId, investigationId, decision: 'APPROVED' },
        orderBy: { reviewedAt: 'desc' },
        include: { reviewer: { select: { fullName: true } } },
      }),
      this.prisma.mediaAsset.findMany({
        where: {
          tenantId,
          investigationId,
          deletedAt: null,
          status: { in: ['UPLOADED', 'CLEAN'] },
          mediaType: { in: [MediaType.PHOTO, MediaType.SIGNATURE] },
        },
        include: { category: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.gpsEvent.findMany({
        where: {
          tenantId,
          investigationId,
          eventType: { in: ['CHECK_IN', 'CHECK_OUT', 'PHOTO_CAPTURE'] },
        },
        orderBy: { recordedAt: 'asc' },
        take: 20,
      }),
      this.prisma.report.findUniqueOrThrow({
        where: { id: reportId },
        include: { template: true },
      }),
    ]);

    // Answers, grouped by the section they were asked in and labelled from the
    // schema — so a report reads as the form the investigator filled in, not as
    // a JSON dump. Conditional fields that were never shown are skipped.
    const answerSections = submission
      ? this.buildAnswerSections(
          submission.formVersion.schema as unknown as FormSchema,
          (submission.answers ?? {}) as Record<string, unknown>,
        )
      : [];

    const photos = media.filter((m) => m.mediaType === MediaType.PHOTO);
    const signature = media.find((m) => m.mediaType === MediaType.SIGNATURE);

    const embedded = await this.embedImages(
      tenantId,
      photos.slice(0, MAX_EMBEDDED_PHOTOS),
    );

    const signatureDataUri = signature
      ? await this.embedOne(tenantId, signature.storageKey, signature.mimeType)
      : null;

    const verificationUrl = `${env('CLIENT_URL', '')}/verify/${investigation.caseNumber}`;
    const qrDataUri = report.template?.showQrCode
      ? await this.renderer.qrDataUri(verificationUrl)
      : await this.renderer.qrDataUri(verificationUrl);

    const resultLabels: Record<
      string,
      { ar: string; en: string; cls: string }
    > = {
      POSITIVE: { ar: 'نتيجة إيجابية', en: 'Positive', cls: 'positive' },
      NEGATIVE: { ar: 'نتيجة سلبية', en: 'Negative', cls: 'negative' },
      PARTIAL: { ar: 'نتيجة جزئية', en: 'Partial', cls: 'neutral' },
      NOT_FOUND: {
        ar: 'لم يتم العثور على العميل',
        en: 'Not found',
        cls: 'neutral',
      },
      REFUSED: { ar: 'رفض التعاون', en: 'Refused', cls: 'negative' },
      UNREACHABLE: { ar: 'تعذر الوصول', en: 'Unreachable', cls: 'neutral' },
    };
    const result = investigation.result
      ? resultLabels[investigation.result]
      : null;

    return {
      generatedAt: new Date().toISOString(),
      tenant: investigation.tenant,
      investigation: {
        ...investigation,
        tenant: undefined,
        customer: undefined,
      },
      customer: investigation.customer,
      product: investigation.product,
      investigationType: investigation.investigationType,
      governorate: investigation.governorate,
      city: investigation.city,
      district: investigation.district,
      investigator: investigation.investigator,
      coordinator: investigation.coordinator,
      report: { version: report.version, locale: report.locale },
      answerSections,
      photos: embedded,
      signatureDataUri,
      qrDataUri,
      gpsEvents: gpsEvents.map((event) => ({
        eventType: event.eventType,
        lat: Number(event.lat).toFixed(6),
        lng: Number(event.lng).toFixed(6),
        accuracyM: event.accuracyM ? Math.round(Number(event.accuracyM)) : null,
        recordedAt: event.recordedAt,
      })),
      qc: qcReview
        ? {
            decision: qcReview.decision,
            reviewedAt: qcReview.reviewedAt,
            reviewer: qcReview.reviewer?.fullName,
            comment: qcReview.comment,
          }
        : null,
      resultLabelAr: result?.ar ?? null,
      resultLabelEn: result?.en ?? null,
      verdictClass: result?.cls ?? 'neutral',
      showLogo: report.template?.showLogo ?? true,
      showWatermark: report.template?.showWatermark ?? false,
      watermarkText: report.template?.watermarkText ?? 'CONFIDENTIAL',
      disclaimerAr: report.template?.disclaimerAr ?? null,
      disclaimerEn: report.template?.disclaimerEn ?? null,
      isBilingual: report.locale === ReportLocale.BILINGUAL,
    } as ReportSnapshot;
  }

  /** Answers laid out as the form asked them, with labels from the schema. */
  private buildAnswerSections(
    schema: FormSchema,
    answers: Record<string, unknown>,
  ) {
    return schema.sections
      .filter((section) => isVisible(section.visibleWhen, answers))
      .map((section) => ({
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        rows: section.fields
          .filter(
            (field) =>
              field.type !== 'SECTION_NOTE' &&
              !['PHOTO', 'FILE', 'SIGNATURE'].includes(field.type) &&
              isVisible(field.visibleWhen, answers),
          )
          .map((field) => ({
            labelAr: field.labelAr,
            labelEn: field.labelEn,
            value: this.formatAnswer(field, answers[field.key]),
          })),
      }))
      .filter((section) => section.rows.length > 0);
  }

  /** An answer as it should read in a document, not as it is stored. */
  private formatAnswer(
    field: {
      type: string;
      options?: { value: string; labelAr: string; labelEn: string }[];
    },
    value: unknown,
  ): string {
    if (value === null || value === undefined || value === '') return '—';

    // An option's stored value is a code; a report has to show the label, in
    // both languages, or it reads as `CUSTOMER_NOT_FOUND`.
    if (field.options?.length) {
      const asArray = Array.isArray(value) ? value : [value];
      const labels = asArray.map((item) => {
        const option = field.options!.find((o) => o.value === String(item));
        return option ? `${option.labelAr} / ${option.labelEn}` : String(item);
      });
      return labels.join('، ');
    }

    if (field.type === 'GPS' && typeof value === 'object') {
      const point = value as { lat?: number; lng?: number };
      return `${point.lat}, ${point.lng}`;
    }

    if (Array.isArray(value)) {
      // An array of objects — a repeating form group, say — must not render
      // as a row of "[object Object]".
      return value
        .map((v) =>
          typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
        )
        .join('، ');
    }

    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'function') return '';

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value);
  }

  /** Fetch and inline images, skipping any that cannot be read. */
  private async embedImages(
    tenantId: string,
    assets: {
      storageKey: string;
      mimeType: string;
      category: { nameAr: string; nameEn: string } | null;
      caption: string | null;
    }[],
  ) {
    const out: {
      dataUri: string;
      categoryAr: string;
      categoryEn: string;
    }[] = [];

    for (const asset of assets) {
      const dataUri = await this.embedOne(
        tenantId,
        asset.storageKey,
        asset.mimeType,
      );
      if (!dataUri) continue;

      out.push({
        dataUri,
        categoryAr: asset.category?.nameAr ?? asset.caption ?? 'صورة',
        categoryEn: asset.category?.nameEn ?? 'Photo',
      });
    }

    return out;
  }

  /**
   * One image as a data URI.
   *
   * A missing object must not fail the whole report: an evidence photo the
   * storage cannot serve is worth a gap in the document and a log line, not a
   * report nobody can produce.
   */
  private async embedOne(
    tenantId: string,
    storageKey: string,
    mimeType: string,
  ): Promise<string | null> {
    try {
      const buffer = await this.storage.getObject(tenantId, storageKey);
      return this.renderer.toDataUri(buffer, mimeType);
    } catch (error) {
      this.logger.warn(
        `Could not embed ${storageKey} in report: ${String(error)}`,
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────────────────

  async listForInvestigation(tenantId: string, investigationId: string) {
    return this.prisma.report.findMany({
      where: { tenantId, investigationId },
      orderBy: { version: 'desc' },
      include: {
        requestedBy: { select: { id: true, fullName: true } },
        template: { select: { id: true, code: true, nameEn: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const report = await this.prisma.report.findFirst({
      where: { tenantId, id },
      include: {
        investigation: { select: { id: true, caseNumber: true } },
        template: { select: { id: true, code: true, nameEn: true } },
        requestedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!report) {
      throw new NotFoundException('التقرير غير موجود - Report not found');
    }
    return report;
  }

  /** A download URL, audited. Same reasoning as media downloads. */
  async downloadUrl(tenantId: string, user: AuthenticatedUser, id: string) {
    const report = await this.findOne(tenantId, id);

    if (report.status !== ReportStatus.READY || !report.storageKey) {
      throw new BadRequestException(
        `التقرير غير جاهز (${report.status}) - The report is not ready (${report.status})`,
      );
    }

    await this.audit.log({
      tenantId,
      action: 'REPORT_DOWNLOADED',
      category: 'REPORT',
      entityType: 'Report',
      entityId: id,
      entityLabel: report.fileName ?? undefined,
    });

    if (!this.storage.supportsPresignedUploads) {
      return { url: null, streamThroughApi: true, expiresIn: 0 };
    }

    const { url, expiresIn } = await this.storage.presignDownload(
      tenantId,
      report.storageKey,
      report.fileName ?? 'report.pdf',
    );
    void user;
    return { url, streamThroughApi: false, expiresIn };
  }

  async readBytes(tenantId: string, id: string) {
    const report = await this.findOne(tenantId, id);
    if (!report.storageKey) {
      throw new BadRequestException(
        'التقرير غير جاهز - The report is not ready',
      );
    }
    return {
      buffer: await this.storage.getObject(tenantId, report.storageKey),
      fileName: report.fileName ?? 'report.pdf',
    };
  }

  /**
   * Which template applies: the investigation type's, then the product's, then
   * the tenant default. An explicit choice from the caller wins over all three.
   */
  private async resolveTemplateId(
    tenantId: string,
    investigationTypeId: string,
    productId: string,
    explicit?: string,
  ): Promise<string | undefined> {
    if (explicit) {
      const chosen = await this.prisma.reportTemplate.findFirst({
        where: { tenantId, id: explicit, isActive: true },
        select: { id: true },
      });
      if (!chosen) {
        throw new BadRequestException(
          'قالب التقرير غير موجود - Report template not found',
        );
      }
      return chosen.id;
    }

    const [type, product, fallback] = await Promise.all([
      this.prisma.investigationType.findFirst({
        where: { tenantId, id: investigationTypeId },
        select: { reportTemplateId: true },
      }),
      this.prisma.product.findFirst({
        where: { tenantId, id: productId },
        select: { reportTemplateId: true },
      }),
      this.prisma.reportTemplate.findFirst({
        where: { tenantId, isDefault: true, isActive: true },
        select: { id: true },
      }),
    ]);

    return (
      type?.reportTemplateId ??
      product?.reportTemplateId ??
      fallback?.id ??
      undefined
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Templates
  // ─────────────────────────────────────────────────────────────────────────

  async listTemplates(tenantId: string) {
    return this.prisma.reportTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { nameEn: 'asc' }],
    });
  }

  async upsertTemplate(
    tenantId: string,
    data: Prisma.ReportTemplateUncheckedCreateInput,
    id?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.reportTemplate.updateMany({
          where: { tenantId, isDefault: true, ...(id ? { NOT: { id } } : {}) },
          data: { isDefault: false },
        });
      }

      if (id) {
        const existing = await tx.reportTemplate.findFirst({
          where: { tenantId, id },
        });
        if (!existing) {
          throw new NotFoundException('القالب غير موجود - Template not found');
        }
        return tx.reportTemplate.update({
          where: { id },
          data: { ...data, tenantId, code: existing.code },
        });
      }

      return tx.reportTemplate.create({ data: { ...data, tenantId } });
    });
  }
}
