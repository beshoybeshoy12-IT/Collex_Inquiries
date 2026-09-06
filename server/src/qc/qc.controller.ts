import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QcService } from './qc.service';
import {
  QcDecisionDto,
  QcQueueQueryDto,
  UpsertRejectionReasonDto,
} from './dto/qc.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/qc`
 *
 * Note there is no PATCH on a review and no DELETE. A verdict is a record of
 * what a reviewer decided at a moment; changing it later would make the
 * rejection-rate report unfalsifiable. A reviewer who has changed their mind
 * reviews the case again after it comes back, and both passes are visible.
 */
@ApiTags('qc')
@ApiBearerAuth()
@Controller({ path: 'qc', version: '1' })
export class QcController {
  constructor(private readonly qc: QcService) {}

  @Get('queue')
  @RequirePermission(P.QC_VIEW)
  @ApiOperation({ summary: 'Cases waiting for review, oldest first' })
  queue(@TenantId() tenantId: string, @Query() query: QcQueueQueryDto) {
    return this.qc.queue(tenantId, query);
  }

  @Get('statistics')
  @RequirePermission(P.QC_VIEW, P.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Approval and rejection rates, with top reasons' })
  statistics(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.qc.statistics(
      tenantId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('reasons')
  @RequirePermission(P.QC_VIEW)
  @ApiOperation({ summary: 'Configured rejection reasons' })
  listReasons(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.qc.listReasons(tenantId, activeOnly === 'true');
  }

  @Post('reasons')
  @RequirePermission(P.QC_MANAGE_REASONS)
  @ApiOperation({ summary: 'Add a rejection reason' })
  createReason(
    @TenantId() tenantId: string,
    @Body() dto: UpsertRejectionReasonDto,
  ) {
    return this.qc.upsertReason(tenantId, dto);
  }

  @Patch('reasons/:id')
  @RequirePermission(P.QC_MANAGE_REASONS)
  @ApiOperation({ summary: 'Edit a rejection reason' })
  updateReason(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRejectionReasonDto,
  ) {
    return this.qc.upsertReason(tenantId, dto, id);
  }

  @Delete('reasons/:id')
  @RequirePermission(P.QC_MANAGE_REASONS)
  @ApiOperation({
    summary: 'Delete a reason, or deactivate it if it is in use',
  })
  removeReason(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qc.removeReason(tenantId, id);
  }

  @Get(':investigationId')
  @RequirePermission(P.QC_VIEW)
  @ApiOperation({
    summary: 'Everything a reviewer needs: answers, evidence, GPS and history',
  })
  packet(
    @TenantId() tenantId: string,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
  ) {
    return this.qc.reviewPacket(tenantId, investigationId);
  }

  /**
   * One endpoint for all three verdicts. The permission list is OR'd because a
   * tenant may split approve and reject between different roles, and a
   * reviewer holding either must be able to reach the route — the service then
   * checks the specific decision.
   */
  @Post(':investigationId/decision')
  @RequirePermission(P.QC_APPROVE, P.QC_REJECT, P.QC_REWORK)
  @ApiOperation({ summary: 'Approve, reject, or send back for rework' })
  decide(
    @TenantId() tenantId: string,
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: QcDecisionDto,
  ) {
    return this.qc.decide(tenantId, reviewer, investigationId, dto);
  }
}
