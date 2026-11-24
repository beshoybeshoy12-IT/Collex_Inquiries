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
import { decodeUploadName, safeFileName } from '../common/utils/file-name.util';
import {
  ConfirmImportDto,
  FixImportDto,
  PrepareImportDto,
  ResolveDuplicatesDto,
} from './dto/import.dto';
import { AuthenticatedUser } from '../common/decorators/auth.decorators';
import {
  customFieldsFrom,
  extraColumns,
  mappingFrom,
  readClientFields,
  readTemplate,
  TemplateField,
} from '../clients/clients.util';

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
    // Multipart decodes the name as Latin-1; an Arabic name arrives garbled
    // ("ÙØ©Ù.xlsx") unless it is decoded back from UTF-8.
    const fileName = safeFileName(file.originalname);
    const client = dto.clientAccountId
      ? await this.loadClient(tenantId, dto.clientAccountId)
      : null;
    const clientFields = client ? readTemplate(client.templateFields) : [];
    const mapping = await this.resolveMapping(tenantId, dto, clientFields);
    const customFields = customFieldsFrom(clientFields);
    const sheet = parseSheet(file.buffer, {
      sheetName: dto.sheetName,
      headerRow: dto.headerRow,
    });

    if (Object.keys(mapping).length === 0 && customFields.length === 0) {
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
        fileName,
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

    // A client limited to one product (or type) has, in effect, a default.
    const only = (ids?: string[]) => (ids?.length === 1 ? ids[0] : undefined);
    const allowed = {
      productIds: client?.productIds?.length
        ? new Set(client.productIds)
        : null,
      investigationTypeIds: client?.investigationTypeIds?.length
        ? new Set(client.investigationTypeIds)
        : null,
    };
    if (
      (dto.defaultProductId &&
        allowed.productIds &&
        !allowed.productIds.has(dto.defaultProductId)) ||
      (dto.defaultInvestigationTypeId &&
        allowed.investigationTypeIds &&
        !allowed.investigationTypeIds.has(dto.defaultInvestigationTypeId))
    ) {
      throw new BadRequestException(
        'المنتج أو نوع الاستعلام غير متاح لهذه الجهة - ' +
          'That product or inquiry type is not enabled for this client',
      );
    }

    const defaults = {
      productId: dto.defaultProductId ?? only(client?.productIds),
      investigationTypeId:
        dto.defaultInvestigationTypeId ?? only(client?.investigationTypeIds),
      priority: dto.defaultPriority,
      dueAt: dto.defaultDueAt ? new Date(dto.defaultDueAt) : undefined,
    };

    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId,
        reference,
        fileName,
        storageKey: stored?.key,
        fileSize: file.size,
        sheetName: sheet.sheetName,
        status: ImportBatchStatus.PARSING,
        mappingTemplateId: dto.mappingTemplateId,
        clientAccountId: client?.id,
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
      customFields,
      extraFields: extraColumns(sheet.headers, mapping, customFields),
      clientAccountId: client?.id,
      allowed,
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
        fileName,
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
    context: StageContext,
  ) {
    const readColumns = columnsRead(context);
    const live = rows
      .map((raw, index) => ({ rowNumber: index + 1, raw }))
      .filter((row) => !isBlankRow(row.raw, readColumns));

    const evaluated = await this.evaluateRows(tenantId, live, context);

    const staged: Prisma.ImportRowCreateManyInput[] = evaluated.entries.map(
      (entry) => ({
        tenantId,
        batchId,
        rowNumber: entry.rowNumber,
        status: entry.status,
        rawData: entry.raw as never,
        mappedData: entry.value as never,
        errors: entry.errors.length ? (entry.errors as never) : undefined,
        warnings: entry.warnings.length ? (entry.warnings as never) : undefined,
        duplicateOf: entry.duplicateOf.length
          ? (entry.duplicateOf as never)
          : undefined,
      }),
    );

    // Chunked because a single createMany with 50,000 rows exceeds Postgres's
    // parameter limit.
    for (let i = 0; i < staged.length; i += 1000) {
      await this.prisma.importRow.createMany({
        data: staged.slice(i, i + 1000),
      });
    }

    return {
      total: live.length,
      valid: evaluated.valid,
      invalid: evaluated.invalid,
      duplicates: evaluated.duplicates,
      summary: {
        totalRows: live.length,
        validRows: evaluated.valid,
        invalidRows: evaluated.invalid,
        duplicateRows: evaluated.duplicates,
        blankRowsSkipped: rows.length - live.length,
        extraColumns: (context.extraFields ?? []).map((field) => field.header),
        topErrors: evaluated.topErrors,
        unknownValues: evaluated.unknownValues,
        missingDefaults: evaluated.missingDefaults,
      },
    };
  }

  /** Validate rows and find duplicates, without writing anything. */
  private async evaluateRows(
    tenantId: string,
    rows: { rowNumber: number; raw: Record<string, unknown> }[],
    context: StageContext,
  ) {
    const customFields = context.customFields ?? [];
    const errorCounts = new Map<string, number>();
    // What the fix panel offers: values the catalogue does not know, grouped,
    // and rows with no product / type at all (fixed by a batch default).
    const unknown = new Map<
      string,
      { field: string; column: string; value: string; count: number }
    >();
    const missing = { product: 0, investigationType: 0 };

    const validated = rows.map(({ rowNumber, raw }) => {
      const result = validateRow(raw, context);
      const outside = outsideClient(
        result.value,
        context.allowed,
        context.mapping,
      );
      if (outside.length > 0) {
        result.errors.push(...outside);
        result.valid = false;
      }
      if (customFields.length > 0) {
        const extra = readClientFields(raw, customFields);
        if (extra.values.length > 0) result.value.clientFields = extra.values;
        if (extra.errors.length > 0) {
          result.errors.push(...extra.errors);
          result.valid = false;
        }
      }
      if (context.extraFields?.length) {
        const kept = readClientFields(raw, context.extraFields).values;
        if (kept.length > 0) result.value.extraFields = kept;
      }
      for (const error of result.errors) {
        const key = `${error.column}::${error.reasonEn}`;
        errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
      }
      for (const field of ['product', 'investigationType'] as const) {
        if (result.value[`${field}Id`]) continue;
        const column = context.mapping[field];
        const cell = column ? raw[column] : undefined;
        const text =
          typeof cell === 'string' || typeof cell === 'number'
            ? String(cell).trim()
            : '';
        if (!text) {
          missing[field]++;
          continue;
        }
        const key = `${field}::${text.toLowerCase()}`;
        const entry = unknown.get(key) ?? {
          field,
          column: column,
          value: text,
          count: 0,
        };
        entry.count++;
        unknown.set(key, entry);
      }
      return { rowNumber, raw, result };
    });

    const duplicates = await this.detectDuplicates(
      tenantId,
      validated,
      context.clientAccountId,
    );

    let valid = 0;
    let invalid = 0;
    let duplicateCount = 0;

    const entries = validated.map((entry) => {
      const rowDuplicates = duplicates.get(entry.rowNumber) ?? [];
      let status: ImportRowStatus;
      if (!entry.result.valid) {
        status = ImportRowStatus.INVALID;
        invalid++;
      } else if (rowDuplicates.length > 0) {
        status = ImportRowStatus.DUPLICATE;
        duplicateCount++;
      } else {
        status = ImportRowStatus.VALID;
        valid++;
      }
      return {
        rowNumber: entry.rowNumber,
        raw: entry.raw,
        status,
        value: entry.result.value,
        errors: entry.result.errors,
        warnings: entry.result.warnings,
        duplicateOf: rowDuplicates,
      };
    });

    const topErrors = [...errorCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 20)
      .map(([key, count]) => {
        const [column, reason] = key.split('::');
        return { column, reason, count };
      });

    return {
      entries,
      valid,
      invalid,
      duplicates: duplicateCount,
      topErrors,
      unknownValues: [...unknown.values()].sort((x, y) => y.count - x.count),
      missingDefaults: missing,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  2b. Fix before confirming
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Correct a staged batch in place, then check it again.
   *
   * The file is the user's, and a bank's file is often 99% right: a product
   * spelled the bank's way, a missing default, one mistyped national id.
   * Sending the user back to Excel for that loses the afternoon. Three kinds of
   * fix, all applied to the staged copy only — nothing operational is written
   * until confirmation, as before:
   *
   *   - cells:   one cell of one row, typed in.
   *   - replace: every cell in a column holding one value gets another —
   *              "قرض سلع معمرة" → the product's code, for all rows at once.
   *   - defaults: the product / type for rows with no value at all.
   */
  async fix(
    tenantId: string,
    user: AuthenticatedUser,
    batchId: string,
    dto: FixImportDto,
  ) {
    const batch = await this.getBatch(tenantId, batchId);
    if (batch.status !== ImportBatchStatus.PREVIEW_READY) {
      throw new BadRequestException(
        'لا يمكن تعديل دفعة بعد تأكيدها - A batch can be fixed only before it is confirmed',
      );
    }

    // Defaults first: they decide how every row reads.
    const defaults: Prisma.ImportBatchUpdateInput = {};
    if (dto.defaultProductId !== undefined) {
      if (dto.defaultProductId) {
        await this.assertUsable(tenantId, batch.clientAccountId, {
          productId: dto.defaultProductId,
        });
      }
      defaults.defaultProductId = dto.defaultProductId || null;
    }
    if (dto.defaultInvestigationTypeId !== undefined) {
      if (dto.defaultInvestigationTypeId) {
        await this.assertUsable(tenantId, batch.clientAccountId, {
          investigationTypeId: dto.defaultInvestigationTypeId,
        });
      }
      defaults.defaultInvestigationTypeId =
        dto.defaultInvestigationTypeId || null;
    }
    if (Object.keys(defaults).length > 0) {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: defaults,
      });
    }

    // Dropped rows leave the run but stay staged, marked SKIPPED — the record
    // of what the file held and what the user chose not to import.
    let skipped = 0;
    if (dto.skipRows?.length || dto.skipInvalid) {
      const result = await this.prisma.importRow.updateMany({
        where: {
          tenantId,
          batchId,
          status: dto.skipInvalid
            ? ImportRowStatus.INVALID
            : { in: [...OPEN_ROW_STATUSES] },
          ...(dto.skipInvalid ? {} : { rowNumber: { in: dto.skipRows } }),
        },
        data: { status: ImportRowStatus.SKIPPED, resolution: 'SKIP' },
      });
      skipped = result.count;
    }

    const rows = await this.prisma.importRow.findMany({
      where: {
        tenantId,
        batchId,
        status: { in: [...OPEN_ROW_STATUSES] },
      },
      select: { id: true, rowNumber: true, rawData: true, resolution: true },
    });

    const cellsByRow = new Map<number, { column: string; value: string }[]>();
    for (const cell of dto.cells ?? []) {
      const list = cellsByRow.get(cell.rowNumber) ?? [];
      list.push(cell);
      cellsByRow.set(cell.rowNumber, list);
    }

    let changedCells = 0;
    const edited = rows.map((row) => {
      const raw = { ...((row.rawData ?? {}) as Record<string, unknown>) };
      for (const rule of dto.replace ?? []) {
        if (sameCell(raw[rule.column], rule.from)) {
          raw[rule.column] = rule.to;
          changedCells++;
        }
      }
      for (const cell of cellsByRow.get(row.rowNumber) ?? []) {
        raw[cell.column] = cell.value;
        changedCells++;
      }
      return { ...row, raw };
    });

    const updated = await this.revalidate(tenantId, batchId, edited);

    await this.audit.log({
      tenantId,
      action: 'IMPORT_FIXED',
      category: 'IMPORT',
      actorType: user.principalType,
      actorId: user.id,
      actorName: user.fullName,
      entityType: 'ImportBatch',
      entityId: batchId,
      entityLabel: batch.reference,
      newValue: {
        changedCells,
        skipped,
        replaced: (dto.replace ?? []).map(
          (rule) => `${rule.column}: ${rule.from} → ${rule.to}`,
        ),
        ...(Object.keys(defaults).length ? { defaults } : {}),
      },
    });

    return updated;
  }

  /** Check the batch's open rows again, with their (possibly edited) cells. */
  private async revalidate(
    tenantId: string,
    batchId: string,
    rows: {
      id: string;
      rowNumber: number;
      raw: Record<string, unknown>;
      resolution?: string | null;
    }[],
  ) {
    const batch = await this.getBatch(tenantId, batchId);
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row.raw)))];
    const context = await this.contextFor(tenantId, {
      clientAccountId: batch.clientAccountId,
      mapping: (batch.mappingUsed ?? {}) as Record<string, string>,
      defaults: {
        productId: batch.defaultProductId ?? undefined,
        investigationTypeId: batch.defaultInvestigationTypeId ?? undefined,
        priority: batch.defaultPriority ?? undefined,
        dueAt: batch.defaultDueAt ?? undefined,
      },
      headers,
    });

    const evaluated = await this.evaluateRows(tenantId, rows, context);
    const ids = new Map(rows.map((row) => [row.rowNumber, row.id]));

    // A duplicate the user already accepted ("not a problem") stays accepted:
    // re-checking after an unrelated fix must not flag it all over again.
    const accepted = new Set(
      rows
        .filter((row) => row.resolution === 'CREATE_ANYWAY')
        .map((row) => row.rowNumber),
    );
    for (const entry of evaluated.entries) {
      if (
        entry.status === ImportRowStatus.DUPLICATE &&
        accepted.has(entry.rowNumber)
      ) {
        entry.status = ImportRowStatus.VALID;
        evaluated.duplicates--;
        evaluated.valid++;
      }
    }

    for (let i = 0; i < evaluated.entries.length; i += 200) {
      const chunk = evaluated.entries.slice(i, i + 200);
      await this.prisma.$transaction(
        chunk.map((entry) =>
          this.prisma.importRow.update({
            where: { id: ids.get(entry.rowNumber)! },
            data: {
              status: entry.status,
              rawData: entry.raw as never,
              mappedData: entry.value as never,
              errors: entry.errors.length
                ? (entry.errors as never)
                : Prisma.DbNull,
              warnings: entry.warnings.length
                ? (entry.warnings as never)
                : Prisma.DbNull,
              duplicateOf: entry.duplicateOf.length
                ? (entry.duplicateOf as never)
                : Prisma.DbNull,
            },
          }),
        ),
      );
    }

    const previous = (batch.errorSummary ?? {}) as Record<string, unknown>;
    const result = await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        validRows: evaluated.valid,
        invalidRows: evaluated.invalid,
        duplicateRows: evaluated.duplicates,
        errorSummary: {
          ...previous,
          validRows: evaluated.valid,
          invalidRows: evaluated.invalid,
          duplicateRows: evaluated.duplicates,
          topErrors: evaluated.topErrors,
          unknownValues: evaluated.unknownValues,
          missingDefaults: evaluated.missingDefaults,
        } as never,
      },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
        clientAccount: { select: { id: true, nameAr: true, nameEn: true } },
      },
    });
    return result;
  }

  /**
   * Everything validation needs, rebuilt from a staged batch: its mapping and
   * defaults, the catalogue lookups, and its client's template and limits.
   */
  private async contextFor(
    tenantId: string,
    input: {
      clientAccountId: string | null;
      mapping: Record<string, string>;
      defaults: StageContext['defaults'];
      headers: string[];
    },
  ): Promise<StageContext> {
    const client = input.clientAccountId
      ? await this.prisma.clientAccount.findFirst({
          where: { tenantId, id: input.clientAccountId },
          select: {
            id: true,
            templateFields: true,
            productIds: true,
            investigationTypeIds: true,
          },
        })
      : null;
    const customFields = client
      ? customFieldsFrom(readTemplate(client.templateFields))
      : [];
    return {
      mapping: input.mapping,
      lookups: await this.buildLookups(tenantId),
      defaults: input.defaults,
      customFields,
      extraFields: extraColumns(input.headers, input.mapping, customFields),
      clientAccountId: client?.id,
      allowed: {
        productIds: client?.productIds?.length
          ? new Set(client.productIds)
          : null,
        investigationTypeIds: client?.investigationTypeIds?.length
          ? new Set(client.investigationTypeIds)
          : null,
      },
    };
  }

  /** A product / type of this tenant, active, and one the client has. */
  private async assertUsable(
    tenantId: string,
    clientAccountId: string | null,
    pick: { productId?: string; investigationTypeId?: string },
  ) {
    const client = clientAccountId
      ? await this.prisma.clientAccount.findFirst({
          where: { tenantId, id: clientAccountId },
          select: { productIds: true, investigationTypeIds: true },
        })
      : null;
    if (pick.productId) {
      const found = await this.prisma.product.findFirst({
        where: { tenantId, id: pick.productId, isActive: true },
        select: { id: true },
      });
      if (
        !found ||
        (client?.productIds.length &&
          !client.productIds.includes(pick.productId))
      ) {
        throw new BadRequestException(
          'المنتج غير متاح - That product is not available',
        );
      }
    }
    if (pick.investigationTypeId) {
      const found = await this.prisma.investigationType.findFirst({
        where: { tenantId, id: pick.investigationTypeId, isActive: true },
        select: { id: true },
      });
      if (
        !found ||
        (client?.investigationTypeIds.length &&
          !client.investigationTypeIds.includes(pick.investigationTypeId))
      ) {
        throw new BadRequestException(
          'نوع الاستعلام غير متاح - That inquiry type is not available',
        );
      }
    }
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
    clientAccountId?: string,
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
          // An application number is the client's own reference: two banks
          // can each have an application 1001. Within one client it repeats
          // only when the same application is sent twice.
          ...(clientAccountId ? { clientAccountId } : {}),
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
                  clientAccountId: batch.clientAccountId,
                  // The client's own columns and any column nothing read,
                  // each kept as labelled text.
                  additionalData:
                    data.clientFields || data.extraFields
                      ? ({
                          clientFields: data.clientFields,
                          extraFields: data.extraFields,
                        } as never)
                      : undefined,
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
    query: PaginationQueryDto & {
      status?: ImportBatchStatus;
      clientAccountId?: string;
    },
  ) {
    const where: Prisma.ImportBatchWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientAccountId
        ? { clientAccountId: query.clientAccountId }
        : {}),
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
          clientAccount: { select: { id: true, nameAr: true, nameEn: true } },
        },
        orderBy: query.orderBy(['uploadedAt', 'reference'], 'uploadedAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.importBatch.count({ where }),
    ]);

    // Batches uploaded before the name was decoded are repaired on the way out.
    return paginate(
      rows.map((row) => ({ ...row, fileName: decodeUploadName(row.fileName) })),
      total,
      query.page,
      query.limit,
    );
  }

  async getBatch(tenantId: string, batchId: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { tenantId, id: batchId },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
        mappingTemplate: true,
        clientAccount: { select: { id: true, nameAr: true, nameEn: true } },
      },
    });
    if (!batch) {
      throw new NotFoundException('الدفعة غير موجودة - Import batch not found');
    }
    return { ...batch, fileName: decodeUploadName(batch.fileName) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async resolveMapping(
    tenantId: string,
    dto: PrepareImportDto,
    clientFields: TemplateField[] = [],
  ): Promise<Record<string, string>> {
    if (dto.mapping && Object.keys(dto.mapping).length > 0) return dto.mapping;

    // A client's template is a mapping in itself: its columns already say
    // which system field each one feeds.
    if (clientFields.length > 0) return mappingFrom(clientFields);

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

  /** An active client of this tenant, or 404. */
  private async loadClient(tenantId: string, id: string) {
    const client = await this.prisma.clientAccount.findFirst({
      where: { tenantId, id, isActive: true },
      select: {
        id: true,
        templateFields: true,
        productIds: true,
        investigationTypeIds: true,
      },
    });
    if (!client) {
      throw new NotFoundException('الجهة غير موجودة - Client not found');
    }
    return client;
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

/**
 * A row whose product or inquiry type the client does not have. Reported on
 * the cell, like any other problem, so the preview shows which rows and why.
 */
export function outsideClient(
  value: Record<string, unknown>,
  allowed:
    | {
        productIds: Set<string> | null;
        investigationTypeIds: Set<string> | null;
      }
    | undefined,
  mapping: Record<string, string>,
): CellProblem[] {
  const problems: CellProblem[] = [];
  if (!allowed) return problems;
  const productId = value.productId as string | undefined;
  if (productId && allowed.productIds && !allowed.productIds.has(productId)) {
    problems.push({
      field: 'product',
      column: mapping.product ?? 'product',
      reasonAr: 'المنتج غير متاح لهذه الجهة',
      reasonEn: 'This product is not enabled for this client',
    });
  }
  const typeId = value.investigationTypeId as string | undefined;
  if (
    typeId &&
    allowed.investigationTypeIds &&
    !allowed.investigationTypeIds.has(typeId)
  ) {
    problems.push({
      field: 'investigationType',
      column: mapping.investigationType ?? 'investigationType',
      reasonAr: 'نوع الاستعلام غير متاح لهذه الجهة',
      reasonEn: 'This inquiry type is not enabled for this client',
    });
  }
  return problems;
}

/** What validating a batch's rows needs. */
interface StageContext {
  mapping: Record<string, string>;
  lookups: LookupTables;
  defaults: {
    productId?: string;
    investigationTypeId?: string;
    priority?: Priority;
    dueAt?: Date;
  };
  /** The client's own columns, carried onto the case as labelled text. */
  customFields?: TemplateField[];
  /** Columns nothing reads; kept on the case as extra information. */
  extraFields?: TemplateField[];
  clientAccountId?: string;
  /** The client's allowed products / types; null means all. */
  allowed?: {
    productIds: Set<string> | null;
    investigationTypeIds: Set<string> | null;
  };
}

/** Rows still waiting for confirmation — the ones a fix may touch. */
const OPEN_ROW_STATUSES = [
  ImportRowStatus.VALID,
  ImportRowStatus.INVALID,
  ImportRowStatus.DUPLICATE,
] as const;

/** Every column a row is read from, mapped or client-only. */
function columnsRead(context: StageContext): Record<string, string> {
  return {
    ...context.mapping,
    ...Object.fromEntries(
      (context.customFields ?? []).map((field) => [
        `client:${field.key}`,
        field.header,
      ]),
    ),
  };
}

/** A cell equals a value as the user sees it: trimmed, spaces collapsed. */
export function sameCell(cell: unknown, value: string): boolean {
  if (cell === null || cell === undefined) return value.trim() === '';
  if (typeof cell !== 'string' && typeof cell !== 'number') return false;
  const norm = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(String(cell)) === norm(value);
}
