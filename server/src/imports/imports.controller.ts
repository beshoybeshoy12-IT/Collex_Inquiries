import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ImportsService } from './imports.service';
import { MappingTemplatesService } from './mapping-templates.service';
import {
  ConfirmImportDto,
  CreateMappingTemplateDto,
  ImportBatchQueryDto,
  ImportRowQueryDto,
  InspectImportDto,
  PrepareImportDto,
  ResolveDuplicatesDto,
  UpdateMappingTemplateDto,
} from './dto/import.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';
import { ExcelFilePipe } from '../common/pipes/excel-file.pipe';
import { IMPORT_FIELDS } from './utils/field-catalog';
import { buildTemplateWorkbook } from './utils/excel-parser';

/**
 * `/api/v1/imports`
 *
 * The route order mirrors the workflow, and the split between `inspect` and
 * `prepare` is the important part: `inspect` reads the file and proposes a
 * mapping while storing nothing, so a coordinator can open a file, see what is
 * in it and change their mind without leaving a half-made batch behind.
 */
@ApiTags('imports')
@ApiBearerAuth()
@Controller({ path: 'imports', version: '1' })
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly templates: MappingTemplatesService,
  ) {}

  // ── The catalogue and a blank template ──────────────────────────────────

  @Get('fields')
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({ summary: 'Every field an Excel column can be mapped to' })
  fields() {
    return IMPORT_FIELDS.map((field) => ({
      key: field.key,
      labelAr: field.labelAr,
      labelEn: field.labelEn,
      type: field.type,
      required: field.required,
      target: field.target,
      hintAr: field.hintAr,
      hintEn: field.hintEn,
    }));
  }

  @Get('template')
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({
    summary: 'Download a blank workbook with the expected headers',
  })
  downloadTemplate(@Res() res: Response) {
    const buffer = buildTemplateWorkbook(
      IMPORT_FIELDS.map((field) => ({
        header: `${field.labelEn} | ${field.labelAr}`,
        example: exampleFor(field.key),
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="collex-import-template.xlsx"',
    );
    res.send(buffer);
  }

  // ── 1. Inspect ──────────────────────────────────────────────────────────

  @Post('inspect')
  @RequirePermission(P.IMPORTS_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Read headers and propose a mapping. Stores nothing.',
  })
  inspect(
    @UploadedFile(ExcelFilePipe) file: Express.Multer.File,
    @Body() dto: InspectImportDto,
  ) {
    return this.imports.inspect(file.buffer, dto.sheetName, dto.headerRow);
  }

  // ── 2. Prepare (stage + validate) ───────────────────────────────────────

  @Post('prepare')
  @RequirePermission(P.IMPORTS_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Stage and validate a file, producing the preview',
  })
  prepare(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(ExcelFilePipe) file: Express.Multer.File,
    @Body() dto: PrepareImportDto,
  ) {
    return this.imports.prepare(tenantId, user, file, dto);
  }

  // ── 3. Preview ──────────────────────────────────────────────────────────

  @Get()
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({ summary: 'Import history' })
  listBatches(
    @TenantId() tenantId: string,
    @Query() query: ImportBatchQueryDto,
  ) {
    return this.imports.listBatches(tenantId, query);
  }

  @Get(':id')
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({ summary: 'One batch' })
  getBatch(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.getBatch(tenantId, id);
  }

  @Get(':id/rows')
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({
    summary: 'The staged rows, with their errors and duplicates',
  })
  preview(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ImportRowQueryDto,
  ) {
    return this.imports.preview(tenantId, id, query);
  }

  @Get(':id/error-report')
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({
    summary: 'Failed rows as a correctable workbook',
  })
  async errorReport(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const report = await this.imports.errorReport(tenantId, id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.fileName}"`,
    );
    res.send(report.buffer);
  }

  // ── 4. Resolve duplicates, then confirm ─────────────────────────────────

  @Post(':id/resolve-duplicates')
  @RequirePermission(P.IMPORTS_RESOLVE_DUPLICATES)
  @ApiOperation({ summary: 'Decide what to do about each flagged duplicate' })
  resolveDuplicates(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDuplicatesDto,
  ) {
    return this.imports.resolveDuplicates(tenantId, id, dto);
  }

  @Post(':id/confirm')
  @RequirePermission(P.IMPORTS_CONFIRM)
  @ApiOperation({ summary: 'Create customers and cases from the staged rows' })
  confirm(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.imports.confirm(tenantId, user, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermission(P.IMPORTS_CANCEL)
  @ApiOperation({ summary: 'Abandon a batch before it is confirmed' })
  cancel(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.cancel(tenantId, id);
  }

  // ── Mapping templates ───────────────────────────────────────────────────

  @Get('mappings/all')
  @RequirePermission(P.IMPORTS_VIEW)
  @ApiOperation({ summary: 'Saved column-mapping templates' })
  listTemplates(@TenantId() tenantId: string) {
    return this.templates.findAll(tenantId);
  }

  @Post('mappings')
  @RequirePermission(P.IMPORTS_MANAGE_MAPPINGS)
  @ApiOperation({ summary: 'Save a reusable column mapping for a client' })
  createTemplate(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMappingTemplateDto,
  ) {
    return this.templates.create(tenantId, user, dto);
  }

  @Post('mappings/:id')
  @RequirePermission(P.IMPORTS_MANAGE_MAPPINGS)
  @ApiOperation({ summary: 'Edit a mapping template' })
  updateTemplate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMappingTemplateDto,
  ) {
    return this.templates.update(tenantId, id, dto);
  }

  @Delete('mappings/:id')
  @RequirePermission(P.IMPORTS_MANAGE_MAPPINGS)
  @ApiOperation({ summary: 'Delete a mapping template' })
  removeTemplate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.remove(tenantId, id);
  }
}

/** Example values for the downloadable template's single sample row. */
function exampleFor(key: string): string {
  const examples: Record<string, string> = {
    fullName: 'أحمد محمد علي حسن',
    nationalId: '29001011234567',
    mobile: '01001234567',
    altMobile: '01112345678',
    homePhone: '0223456789',
    residenceAddress: '15 شارع الجمهورية، الدور 3، شقة 12',
    governorate: 'القاهرة',
    city: 'مدينة نصر',
    district: 'الحي الثامن',
    workplaceName: 'شركة النيل للتجارة',
    workplaceAddress: '22 شارع التحرير، الدقي',
    workplacePhone: '0233334444',
    jobTitle: 'محاسب',
    applicationNumber: 'APP-2026-00123',
    product: 'PERSONAL_LOAN',
    investigationType: 'RESIDENCE',
    priority: 'NORMAL',
    dueDate: '15/04/2026',
    notes: 'العميل متاح بعد الساعة 4 عصرًا',
  };
  return examples[key] ?? '';
}
