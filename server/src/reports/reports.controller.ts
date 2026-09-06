import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { GenerateReportDto, UpsertReportTemplateDto } from './dto/report.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

@ApiTags('reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('templates')
  @RequirePermission(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Report templates' })
  listTemplates(@TenantId() tenantId: string) {
    return this.reports.listTemplates(tenantId);
  }

  @Post('templates')
  @RequirePermission(P.REPORTS_MANAGE_TEMPLATES)
  @ApiOperation({ summary: 'Create a report template' })
  createTemplate(
    @TenantId() tenantId: string,
    @Body() dto: UpsertReportTemplateDto,
  ) {
    return this.reports.upsertTemplate(tenantId, dto as never);
  }

  @Patch('templates/:id')
  @RequirePermission(P.REPORTS_MANAGE_TEMPLATES)
  @ApiOperation({ summary: 'Edit a report template' })
  updateTemplate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertReportTemplateDto,
  ) {
    return this.reports.upsertTemplate(tenantId, dto as never, id);
  }

  @Get('investigation/:investigationId')
  @RequirePermission(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'Every report version for one case' })
  listForInvestigation(
    @TenantId() tenantId: string,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
  ) {
    return this.reports.listForInvestigation(tenantId, investigationId);
  }

  /**
   * Queues a render and returns immediately. The client polls this report's
   * status, or waits for the `REPORT_READY` notification that arrives over the
   * socket when the worker finishes.
   */
  @Post('investigation/:investigationId/generate')
  @RequirePermission(P.REPORTS_GENERATE)
  @ApiOperation({ summary: 'Queue a new report version for a case' })
  generate(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reports.request(tenantId, user, investigationId, dto);
  }

  @Get(':id')
  @RequirePermission(P.REPORTS_VIEW)
  @ApiOperation({ summary: 'One report, with its generation status' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reports.findOne(tenantId, id);
  }

  @Get(':id/download')
  @RequirePermission(P.REPORTS_DOWNLOAD)
  @ApiOperation({ summary: 'A time-limited PDF download URL, or the bytes' })
  async download(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reports.downloadUrl(tenantId, user, id);
    if (!result.streamThroughApi) return result;

    const file = await this.reports.readBytes(tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '')}"`,
    );
    res.send(file.buffer);
  }
}
