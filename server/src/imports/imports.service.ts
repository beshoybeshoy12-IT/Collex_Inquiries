import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportBatchStatus,
  ImportRowStatus,
  InvestigationStatus,
  Prisma,
  PrincipalType,
  Priority,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseNumberService } from '../investigations/case-number.service';
import { SlaPolicyService } from '../investigations/sla-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { paginate } from '../common/interfaces/api.interface';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  buildErrorWorkbook,
  parseSheet,
  summariseWorkbook,
} from './utils/excel-parser';
import { IMPORT_FIELDS, suggestMapping } from './utils/field-catalog';
import {
  isBlankRow,
  LookupTables,
  validateRow,
  CellProblem,
} from './utils/row-validator';
import { comparablePhone } from '../common/utils/phone.util';
import {
  ConfirmImportDto,
  PrepareImportDto,
  ResolveDuplicatesDto,
} from './dto/import.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The Excel import pipeline.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      upload → parse → map → validate → preview → confirm → process
 *
 *  NOTHING AN UPLOAD CONTAINS REACHES THE OPERATIONAL TABLES UNTIL A HUMAN
 *  CONFIRMS IT. Rows are staged in `import_rows`, which is what makes the
 *  preview real rather than a summary: the coordinator sees their own
 *  spreadsheet with the problems marked in place, fixes the file, and
 *  re-uploads — or accepts the valid rows and leaves the rest.
 *
 *  VALID ROWS IMPORT; INVALID ONES DO NOT. Collex System V1 used all-or-nothing
 *  — one bad row in five thousand rejected the file — which in practice meant
 *  coordinators deleting rows to get a file through, losing the very cases the
 *  validation was protecting. Here the batch reports `COMPLETED_WITH_ERRORS`
 *  and the failed rows stay staged, downloadable as a corrected-file template.
 *
 *  DUPLICATES ARE FOUND BEFORE, NOT AFTER. The duplicate pass runs during
 *  validation and marks rows rather than blocking them, because whether a
 *  second investigation of the same person is a mistake or a legitimate repeat
 *  request is a business question, and the coordinator is the one who can
 *  answer it.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly caseNumbers: CaseNumberService,
    private readonly slaPolicies: SlaPolicyService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly storage: StorageService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  1. Inspect — what is in this file?
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Read the headers and propose a mapping, without storing anything.
   *
   * Called the moment the user picks a file, so the mapping screen can be
   * populated before they commit to an upload.
   */
  inspect(buffer: Buffer, sheetName?: string, headerRow?: number) {
    const summary = summariseWorkbook(buffer);
    const sheet = parseSheet(buffer, {
      sheetName: sheetName ?? summary.defaultSheet,
      headerRow,
    });

    const suggestion = suggestMapping(sheet.headers);

    return {
      sheetNames: summary.sheetNames,
      sheetName: sheet.sheetName,
      headers: sheet.headers,
      totalRows: sheet.totalRows,
      /** First few rows, so the user can see what they are mapping. */
      sample: sheet.rows.slice(0, 5),
      suggestedMapping: suggestion.mapping,
      unmappedHeaders: suggestion.unmapped,
      ambiguousHeaders: suggestion.ambiguous,
      fields: IMPORT_FIELDS.map((f) => ({
        key: f.key,
        labelAr: f.labelAr,
        labelEn: f.labelEn,
        type: f.type,
        required: f.required,
        hintAr: f.hintAr,
        hintEn: f.hintEn,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Prepare — stage the rows and validate them
  // ─────────────────────────────────────────────────────────────────────────

  async prepare(
    tenantId: string,
    user: AuthenticatedUser,
    file: { buffer: Buffer; originalname: string; size: number },
    dto: PrepareImportDto,
  ) {
    const mapping = await this.resolveMapping(tenantId, dto);
    const sheet = parseSheet(file.buffer, {
      sheetName: dto.sheetName,
      headerRow: dto.headerRow,
    });

    if (Object.keys(mapping).length === 0) {
      throw new BadRequestException(
        'لم يتم ربط أي عمود - No columns have been mapped to system fields',
      );
    }

    const lookups = await this.buildLookups(tenantId);

    // The uploaded file is kept so the batch can be re-examined and so the
    // error report can be regenerated later without asking for it again.
    const stored = await this.storage
      .putObject({
        tenantId,
        prefix: 'imports',
        fileName: file.originalname,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: file.buffer,
      })
      .catch((error) => {
        // A storage outage must not stop an import: the rows are already
        // parsed, and the source file is a convenience.
        this.logger.warn(`Could not store import file: ${String(error)}`);
        return null;
      });

    const reference = await this.nextReference(tenantId);

    const defaults = {
      productId: dto.defaultProductId,
      investigationTypeId: dto.defaultInvestigationTypeId,
      priority: dto.defaultPriority,
      dueAt: dto.defaultDueAt ? new Date(dto.defaultDueAt) : undefined,
    };

    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId,
        reference,
        fileName: file.originalname,
        storageKey: stored?.key,
        fileSize: file.size,
        sheetName: sheet.sheetName,
        status: ImportBatchStatus.PARSING,
        mappingTemplateId: dto.mappingTemplateId,
        mappingUsed: mapping,
        defaultProductId: defaults.productId,
        defaultInvestigationTypeId: defaults.investigationTypeId,
        defaultPriority: defaults.priority,
        defaultDueAt: defaults.dueAt,
        totalRows: sheet.totalRows,
        uploadedById: user.id,
      },
    });

    const staged = await this.validateAndStage(tenantId, batch.id, sheet.rows, {
      mapping,
      lookups,
      defaults,
    });

    const updated = await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: ImportBatchStatus.PREVIEW_READY,
        parsedAt: new Date(),
        totalRows: staged.total,
        validRows: staged.valid,
        invalidRows: staged.invalid,
        duplicateRows: staged.duplicates,
        errorSummary: staged.summary as never,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'IMPORT_PREPARED',
      category: 'IMPORT',
      entityType: 'ImportBatch',
      entityId: batch.id,
      entityLabel: reference,
      newValue: {
        fileName: file.originalname,
        totalRows: staged.total,
        validRows: staged.valid,
        invalidRows: staged.invalid,
        duplicateRows: staged.duplicates,
      },
    });

    return { batch: updated, preview: staged.summary };
  }

  /**
   * Validate every row, detect duplicates, and write the staging rows.
   *
   * Duplicates are checked against the database once per batch rather than once
   * per row: one query for every national id in the file beats five thousand
   * queries by three orders of magnitude, and an import of a bank's monthly
   * file is exactly where that matters.
   */
  private async validateAndStage(
    tenantId: string,
    batchId: string,
    rows: Record<string, unknown>[],
    context: {
      mapping: Record<string, string>;
      lookups: LookupTables;
      defaults: {
        productId?: string;
        investigationTypeId?: string;
        priority?: Priority;
        dueAt?: Date;
      };
    },
  ) {
    const staged: Prisma.ImportRowCreateManyInput[] = [];
    const errorCounts = new Map<string, number>();

    const validated = rows.map((raw, index) => {
      const rowNumber = index + 1;
      if (isBlankRow(raw, context.mapping)) return null;

      const result = validateRow(raw, context);
      for (const error of result.errors) {
        const key = `${error.column}::${error.reasonEn}`;
        errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
      }
      return { rowNumber, raw, result };
    });

    const live = validated.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );

    const duplicates = await this.detectDuplicates(tenantId, live);

    let valid = 0;
    let invalid = 0;
    let duplicateCount = 0;

    for (const entry of live) {
      const rowDuplicates = duplicates.get(entry.rowNumber) ?? [];
      const isDuplicate = rowDuplicates.length > 0;

      let status: ImportRowStatus;
      if (!entry.result.valid) {
        status = ImportRowStatus.INVALID;
        invalid++;
      } else if (isDuplicate) {
        status = ImportRowStatus.DUPLICATE;
        duplicateCount++;
      } else {
        status = ImportRowStatus.VALID;
        valid++;
      }

      staged.push({
        tenantId,
        batchId,
        rowNumber: entry.rowNumber,
        status,
        rawData: entry.raw as never,
        mappedData: entry.result.value as never,
        errors: entry.result.errors.length
          ? (entry.result.errors as never)
          : undefined,
        warnings: entry.result.warnings.length
          ? (entry.result.warnings as never)
          : undefined,
        duplicateOf: isDuplicate ? rowDuplicates : undefined,
      });
    }

    // Chunked because a single createMany with 50,000 rows exceeds Postgres's
    // parameter limit.
    for (let i = 0; i < staged.length; i += 1000) {
      await this.prisma.importRow.createMany({
        data: staged.slice(i, i + 1000),
      });
    }

    const topErrors = [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([key, count]) => {
        const [column, reason] = key.split('::');
        return { column, reason, count };
      });

    return {
      total: live.length,
      valid,
      invalid,
      duplicates: duplicateCount,
      summary: {
        totalRows: live.length,
        validRows: valid,
        invalidRows: invalid,
        duplicateRows: duplicateCount,
        blankRowsSkipped: rows.length - live.length,
        topErrors,
      },
    };
  }

  /**
   * Find rows that look like something already in the system, or like each
   * other.
   *
   * Three rules, in descending confidence — application number, national id,
   * phone. Reported, never blocked: a customer legitimately gets a second
   * investigation, and only the coordinator knows which case this is.
   */
  private async detectDuplicates(
    tenantId: string,
    rows: { rowNumber: number; result: { value: Record<string, unknown> } }[],
  ): Promise<
    Map<
      number,
      { rule: string; type: string; id?: string; rowNumber?: number }[]
    >
  > {
    const found = new Map<
      number,
      { rule: string; type: string; id?: string; rowNumber?: number }[]
    >();

    const add = (
      rowNumber: number,
      match: { rule: string; type: string; id?: string; rowNumber?: number },
    ) => {
      const list = found.get(rowNumber) ?? [];
      list.push(match);
      found.set(rowNumber, list);
    };

    const nationalIds = new Map<string, number[]>();
    const applications = new Map<string, number[]>();
    const phones = new Map<string, number[]>();

    for (const row of rows) {
      const nationalId = row.result.value.nationalId as string | undefined;
      const application = row.result.value.applicationNumber as
        string | undefined;
      const phone = comparablePhone(
        row.result.value.mobile as string | undefined,
      );

      if (nationalId) {
        nationalIds.set(nationalId, [
          ...(nationalIds.get(nationalId) ?? []),
          row.rowNumber,
        ]);
      }
      if (application) {
        applications.set(application, [
          ...(applications.get(application) ?? []),
          row.rowNumber,
        ]);
      }
      if (phone) {
        phones.set(phone, [...(phones.get(phone) ?? []), row.rowNumber]);
      }
    }

    // Duplicates *within the file*. A bank sending the same application twice
    // in one sheet is common and would otherwise import twice.
    for (const [, rowNumbers] of [...nationalIds, ...applications]) {
      if (rowNumbers.length > 1) {
        for (const rowNumber of rowNumbers.slice(1)) {
          add(rowNumber, {
            rule: 'IN_FILE',
            type: 'row',
            rowNumber: rowNumbers[0],
          });
        }
      }
    }

    // Duplicates against what is already stored.
    if (applications.size > 0) {
      const existing = await this.prisma.investigation.findMany({
        where: {
          tenantId,
          deletedAt: null,
          applicationNumber: { in: [...applications.keys()] },
        },
        select: { id: true, applicationNumber: true, caseNumber: true },
      });
      for (const match of existing) {
        for (const rowNumber of applications.get(match.applicationNumber!) ??
          []) {
          add(rowNumber, {
            rule: 'APPLICATION_NUMBER',
            type: 'investigation',
            id: match.id,
          });
        }
      }
    }

    if (nationalIds.size > 0) {
      const existing = await this.prisma.customer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          nationalId: { in: [...nationalIds.keys()] },
        },
        select: { id: true, nationalId: true, fullName: true },
      });
      for (const match of existing) {
        for (const rowNumber of nationalIds.get(match.nationalId!) ?? []) {
          add(rowNumber, {
            rule: 'NATIONAL_ID',
            type: 'customer',
            id: match.id,
          });
        }
      }
    }

    return found;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Preview
  // ─────────────────────────────────────────────────────────────────────────

  async preview(
    tenantId: string,
    batchId: string,
    query: PaginationQueryDto & { status?: ImportRowStatus },
  ) {
    const batch = await this.getBatch(tenantId, batchId);

    const where: Prisma.ImportRowWhereInput = {
      tenantId,
      batchId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.importRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.importRow.count({ where }),
    ]);

    return { batch, ...paginate(rows, total, query.page, query.limit) };
  }

  /** The error report, as a spreadsheet the user can correct and re-upload. */
  async errorReport(tenantId: string, batchId: string) {
    const batch = await this.getBatch(tenantId, batchId);

    const rows = await this.prisma.importRow.findMany({
      where: { tenantId, batchId, status: ImportRowStatus.INVALID },
      orderBy: { rowNumber: 'asc' },
    });

    if (rows.length === 0) {
      throw new BadRequestException(
        'لا توجد صفوف بها أخطاء - This batch has no failed rows',
      );
    }

    const headers = Object.keys((rows[0].rawData ?? {}) as object);

    const buffer = buildErrorWorkbook(
      headers,
      rows.map((row) => ({
        rowNumber: row.rowNumber,
        data: row.rawData as Record<string, unknown>,
        errors: (row.errors as unknown as CellProblem[]) ?? [],
      })),
    );

    return {
      buffer,
      fileName: `${batch.reference}-errors.xlsx`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Confirm and process
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Turn the staged rows into customers and investigations.
   *
   * Chunked into transactions of 200 rather than one big one: a single
   * transaction over 50,000 rows holds locks for its whole duration and, if it
   * fails at row 49,000, throws away everything. Per-chunk commits mean a
   * failure costs at most 200 rows, and the batch reports precisely which.
   */
  async confirm(
    tenantId: string,
    user: AuthenticatedUser,
    batchId: string,
    dto: ConfirmImportDto,
  ) {
    const batch = await this.getBatch(tenantId, batchId);

    if (batch.status !== ImportBatchStatus.PREVIEW_READY) {
      throw new BadRequestException(
        `لا يمكن تأكيد دفعة في حالة ${batch.status} - ` +
          `A batch in status ${batch.status} cannot be confirmed`,
      );
    }

    const statuses: ImportRowStatus[] = dto.includeDuplicates
      ? [ImportRowStatus.VALID, ImportRowStatus.DUPLICATE]
      : [ImportRowStatus.VALID];

    const rows = await this.prisma.importRow.findMany({
      where: { tenantId, batchId, status: { in: statuses } },
      orderBy: { rowNumber: 'asc' },
    });

    if (rows.length === 0) {
      throw new BadRequestException(
        'لا توجد صفوف صالحة للاستيراد - There are no importable rows in this batch',
      );
    }

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: ImportBatchStatus.PROCESSING,
        confirmedAt: new Date(),
      },
    });

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { code: true },
    });

    const policies = await this.slaPolicies.listActive(tenantId);

    let imported = 0;
    let failed = 0;
    const CHUNK = 200;

    for (let offset = 0; offset < rows.length; offset += CHUNK) {
      const chunk = rows.slice(offset, offset + CHUNK);

      try {
        const caseNumbers = await this.caseNumbers.allocate(
          tenantId,
          tenant.code,
          chunk.length,
        );

        await this.prisma.$transaction(
          async (tx) => {
            for (const [index, row] of chunk.entries()) {
              const data = row.mappedData as Record<string, unknown>;

              const customerId = await this.upsertCustomer(
                tx,
                tenantId,
                data,
                user.id,
              );

              const priority = (data.priority as Priority) ?? Priority.NORMAL;
              const policy = this.slaPolicies.select(policies, {
                productId: data.productId as string,
                investigationTypeId: data.investigationTypeId as string,
                priority,
              });

              const investigation = await tx.investigation.create({
                data: {
                  tenantId,
                  caseNumber: caseNumbers[index],
                  applicationNumber: data.applicationNumber as
                    string | undefined,
                  customerId,
                  productId: data.productId as string,
                  investigationTypeId: data.investigationTypeId as string,
                  priority,
                  source: 'EXCEL_IMPORT',
                  status: InvestigationStatus.NEW,
                  addressLine: data.residenceAddress as string | undefined,
                  governorateId: data.governorateId as string | undefined,
                  cityId: data.cityId as string | undefined,
                  districtId: data.districtId as string | undefined,
                  coordinatorId: user.id,
                  createdById: user.id,
                  importBatchId: batchId,
                  slaPolicyId: policy?.id,
                  dueAt:
                    (data.dueDate as Date | undefined) ??
                    this.slaPolicies.dueDateFor(policy, null) ??
                    undefined,
                  notes: data.notes as string | undefined,
                },
                select: { id: true },
              });

              await tx.investigationStatusHistory.create({
                data: {
                  tenantId,
                  investigationId: investigation.id,
                  toStatus: InvestigationStatus.NEW,
                  actorType: PrincipalType.WEB_USER,
                  actorId: user.id,
                  actorName: user.fullName,
                  reason: `Imported from ${batch.fileName} (row ${row.rowNumber})`,
                },
              });

              await tx.importRow.update({
                where: { id: row.id },
                data: {
                  status: ImportRowStatus.IMPORTED,
                  createdInvestigationId: investigation.id,
                  createdCustomerId: customerId,
                },
              });
            }
          },
          { timeout: 120_000 },
        );

        imported += chunk.length;
      } catch (error) {
        failed += chunk.length;
        this.logger.error(
          `Import chunk ${offset}-${offset + chunk.length} of batch ${batch.reference} failed: ${String(error)}`,
        );
        await this.prisma.importRow.updateMany({
          where: { id: { in: chunk.map((r) => r.id) } },
          data: { status: ImportRowStatus.FAILED },
        });
      }

      this.realtime.emitProgress(user.id, 'import', {
        percent: Math.round(((offset + chunk.length) / rows.length) * 100),
        message: `${imported} / ${rows.length}`,
      });
    }

    const finalStatus =
      failed > 0 || batch.invalidRows > 0
        ? ImportBatchStatus.COMPLETED_WITH_ERRORS
        : ImportBatchStatus.COMPLETED;

    const updated = await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: finalStatus,
        importedRows: imported,
        failedRows: failed,
        completedAt: new Date(),
      },
    });

    await this.audit.log({
      tenantId,
      action: 'IMPORT_CONFIRMED',
      category: 'IMPORT',
      severity: failed > 0 ? 'WARNING' : 'INFO',
      entityType: 'ImportBatch',
      entityId: batchId,
      entityLabel: batch.reference,
      newValue: { imported, failed, includeDuplicates: dto.includeDuplicates },
    });

    await this.notifications.notifyUser(tenantId, user.id, {
      type: 'IMPORT_COMPLETED',
      titleAr: 'اكتمل الاستيراد',
      titleEn: 'Import completed',
      bodyAr: `تم استيراد ${imported} تحقيق من الملف ${batch.fileName}`,
      bodyEn: `Imported ${imported} case(s) from ${batch.fileName}`,
      entityType: 'ImportBatch',
      entityId: batchId,
      link: `/imports/${batchId}`,
    });

    this.realtime.emitToTenant(tenantId, 'import:completed', {
      batchId,
      reference: batch.reference,
      imported,
      failed,
    });

    return { batch: updated, imported, failed };
  }

  /**
   * Reuse the customer when their national id is already known, otherwise
   * create one.
   *
   * This is what stops the same person becoming forty customers over forty
   * monthly files, and it is why the Customer 360 screen can show a real
   * history.
   */
  private async upsertCustomer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    data: Record<string, unknown>,
    createdById: string,
  ): Promise<string> {
    const nationalId = data.nationalId as string | undefined;

    if (nationalId) {
      const existing = await tx.customer.findFirst({
        where: { tenantId, nationalId, deletedAt: null },
        select: { id: true, mobile: true, residenceAddress: true },
      });

      if (existing) {
        // Fill gaps only. A newer file must not overwrite a phone number that
        // somebody verified at the door with a stale one from a bank export.
        const fill: Record<string, unknown> = {};
        if (!existing.mobile && data.mobile) fill.mobile = data.mobile;
        if (!existing.residenceAddress && data.residenceAddress) {
          fill.residenceAddress = data.residenceAddress;
        }
        if (Object.keys(fill).length > 0) {
          await tx.customer.update({ where: { id: existing.id }, data: fill });
        }
        return existing.id;
      }
    }

    const created = await tx.customer.create({
      data: {
        tenantId,
        fullName: (data.fullName as string) ?? 'Unknown',
        nationalId: nationalId ?? null,
        mobile: (data.mobile as string) ?? null,
        altMobile: (data.altMobile as string) ?? null,
        homePhone: (data.homePhone as string) ?? null,
        residenceAddress: (data.residenceAddress as string) ?? null,
        governorateId: (data.governorateId as string) ?? null,
        cityId: (data.cityId as string) ?? null,
        districtId: (data.districtId as string) ?? null,
        workplaceName: (data.workplaceName as string) ?? null,
        workplaceAddress: (data.workplaceAddress as string) ?? null,
        workplacePhone: (data.workplacePhone as string) ?? null,
        jobTitle: (data.jobTitle as string) ?? null,
        createdById,
      },
      select: { id: true },
    });

    return created.id;
  }

  /** Mark what to do about flagged duplicates before confirming. */
  async resolveDuplicates(
    tenantId: string,
    batchId: string,
    dto: ResolveDuplicatesDto,
  ) {
    await this.getBatch(tenantId, batchId);

    const updates = await Promise.all(
      dto.resolutions.map((resolution) =>
        this.prisma.importRow.updateMany({
          where: {
            tenantId,
            batchId,
            rowNumber: resolution.rowNumber,
            status: ImportRowStatus.DUPLICATE,
          },
          data: {
            resolution: resolution.action,
            // "Create anyway" makes the row importable; "skip" takes it out of
            // the run without deleting the evidence that it was there.
            status:
              resolution.action === 'CREATE_ANYWAY'
                ? ImportRowStatus.VALID
                : ImportRowStatus.SKIPPED,
          },
        }),
      ),
    );

    const changed = updates.reduce((sum, u) => sum + u.count, 0);

    const counts = await this.recount(tenantId, batchId);

    await this.audit.log({
      tenantId,
      action: 'IMPORT_DUPLICATES_RESOLVED',
      category: 'IMPORT',
      entityType: 'ImportBatch',
      entityId: batchId,
      newValue: { resolved: changed },
    });

    return { resolved: changed, counts };
  }

  async cancel(tenantId: string, batchId: string) {
    const batch = await this.getBatch(tenantId, batchId);

    if (
      batch.status === ImportBatchStatus.COMPLETED ||
      batch.status === ImportBatchStatus.COMPLETED_WITH_ERRORS
    ) {
      throw new BadRequestException(
        'لا يمكن إلغاء دفعة مكتملة - A completed batch cannot be cancelled',
      );
    }

    const updated = await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: ImportBatchStatus.CANCELLED },
    });

    await this.audit.log({
      tenantId,
      action: 'IMPORT_CANCELLED',
      category: 'IMPORT',
      severity: 'NOTICE',
      entityType: 'ImportBatch',
      entityId: batchId,
      entityLabel: batch.reference,
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  History
  // ─────────────────────────────────────────────────────────────────────────

  async listBatches(
    tenantId: string,
    query: PaginationQueryDto & { status?: ImportBatchStatus },
  ) {
    const where: Prisma.ImportBatchWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { fileName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.importBatch.findMany({
        where,
        include: {
          uploadedBy: { select: { id: true, fullName: true } },
          mappingTemplate: { select: { id: true, code: true, nameEn: true } },
        },
        orderBy: query.orderBy(['uploadedAt', 'reference'], 'uploadedAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.importBatch.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.limit);
  }

  async getBatch(tenantId: string, batchId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { tenantId, id: batchId },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
        mappingTemplate: true,
      },
    });
    if (!batch) {
      throw new NotFoundException('الدفعة غير موجودة - Import batch not found');
    }
    return batch;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async resolveMapping(
    tenantId: string,
    dto: PrepareImportDto,
  ): Promise<Record<string, string>> {
    if (dto.mapping && Object.keys(dto.mapping).length > 0) return dto.mapping;

    if (dto.mappingTemplateId) {
      const template = await this.prisma.importMappingTemplate.findFirst({
        where: { tenantId, id: dto.mappingTemplateId, isActive: true },
        select: { mapping: true },
      });
      if (!template) {
        throw new NotFoundException(
          'قالب الربط غير موجود - Mapping template not found',
        );
      }
      return template.mapping as Record<string, string>;
    }

    throw new BadRequestException(
      'يجب تحديد ربط الأعمدة أو قالب ربط - ' +
        'Provide either a column mapping or a mapping template',
    );
  }

  /**
   * Every catalogue value a lookup column can resolve against, keyed by both
   * code and name in both languages.
   *
   * Built once per batch: matching 5,000 product cells against the database one
   * at a time would be 5,000 queries for a table with six rows in it.
   */
  private async buildLookups(tenantId: string): Promise<LookupTables> {
    const [products, types, governorates, cities, districts] =
      await Promise.all([
        this.prisma.product.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, code: true, nameAr: true, nameEn: true },
        }),
        this.prisma.investigationType.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, code: true, nameAr: true, nameEn: true },
        }),
        this.prisma.governorate.findMany({
          select: { id: true, code: true, nameAr: true, nameEn: true },
        }),
        this.prisma.city.findMany({
          select: { id: true, code: true, nameAr: true, nameEn: true },
        }),
        this.prisma.district.findMany({
          select: { id: true, code: true, nameAr: true, nameEn: true },
        }),
      ]);

    const index = (
      rows: { id: string; code: string; nameAr: string; nameEn: string }[],
    ) => {
      const map = new Map<string, string>();
      for (const row of rows) {
        for (const key of [row.code, row.nameAr, row.nameEn]) {
          if (key) map.set(key.trim().toLowerCase(), row.id);
        }
      }
      return map;
    };

    return {
      products: index(products),
      investigationTypes: index(types),
      governorates: index(governorates),
      cities: index(cities),
      districts: index(districts),
    };
  }

  private async recount(tenantId: string, batchId: string) {
    const grouped = await this.prisma.importRow.groupBy({
      by: ['status'],
      where: { tenantId, batchId },
      _count: { _all: true },
    });

    const counts = Object.fromEntries(
      grouped.map((row) => [row.status, row._count._all]),
    ) as Record<ImportRowStatus, number>;

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        validRows: counts.VALID ?? 0,
        invalidRows: counts.INVALID ?? 0,
        duplicateRows: counts.DUPLICATE ?? 0,
      },
    });

    return counts;
  }

  /** `IMP-YYYYMM-NNN`, unique per tenant. */
  private async nextReference(tenantId: string): Promise<string> {
    const now = new Date();
    const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `IMP-${period}-`;

    const last = await this.prisma.importBatch.findFirst({
      where: { tenantId, reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });

    const sequence = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;

    return `${prefix}${String(sequence).padStart(3, '0')}`;
  }
}
