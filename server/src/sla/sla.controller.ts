import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EscalationTrigger } from '@prisma/client';
import { SlaService } from './sla.service';
import { UpsertEscalationRuleDto, UpsertSlaPolicyDto } from './dto/sla.dto';
import {
  RequirePermission,
  TenantId,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

@ApiTags('sla')
@ApiBearerAuth()
@Controller({ path: 'sla', version: '1' })
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  @Get('triggers')
  @RequirePermission(P.SLA_VIEW)
  @ApiOperation({ summary: 'The escalation triggers this build understands' })
  triggers() {
    return Object.values(EscalationTrigger);
  }

  // ── Policies ────────────────────────────────────────────────────────────

  @Get('policies')
  @RequirePermission(P.SLA_VIEW)
  @ApiOperation({ summary: 'List SLA policies' })
  listPolicies(@TenantId() tenantId: string) {
    return this.sla.listPolicies(tenantId);
  }

  @Post('policies')
  @RequirePermission(P.SLA_MANAGE)
  @ApiOperation({ summary: 'Create an SLA policy' })
  createPolicy(@TenantId() tenantId: string, @Body() dto: UpsertSlaPolicyDto) {
    return this.sla.upsertPolicy(tenantId, dto);
  }

  @Patch('policies/:id')
  @RequirePermission(P.SLA_MANAGE)
  @ApiOperation({ summary: 'Edit an SLA policy' })
  updatePolicy(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertSlaPolicyDto,
  ) {
    return this.sla.upsertPolicy(tenantId, dto, id);
  }

  @Delete('policies/:id')
  @RequirePermission(P.SLA_MANAGE)
  @ApiOperation({ summary: 'Delete a policy, or deactivate it if in use' })
  removePolicy(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sla.removePolicy(tenantId, id);
  }

  // ── Escalation rules ────────────────────────────────────────────────────

  @Get('escalation-rules')
  @RequirePermission(P.SLA_VIEW)
  @ApiOperation({ summary: 'List escalation rules' })
  listRules(@TenantId() tenantId: string) {
    return this.sla.listRules(tenantId);
  }

  @Post('escalation-rules')
  @RequirePermission(P.SLA_MANAGE)
  @ApiOperation({ summary: 'Create an escalation rule' })
  createRule(
    @TenantId() tenantId: string,
    @Body() dto: UpsertEscalationRuleDto,
  ) {
    return this.sla.upsertRule(tenantId, dto);
  }

  @Patch('escalation-rules/:id')
  @RequirePermission(P.SLA_MANAGE)
  @ApiOperation({ summary: 'Edit an escalation rule' })
  updateRule(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertEscalationRuleDto,
  ) {
    return this.sla.upsertRule(tenantId, dto, id);
  }

  @Delete('escalation-rules/:id')
  @RequirePermission(P.SLA_MANAGE)
  @ApiOperation({ summary: 'Delete an escalation rule' })
  removeRule(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sla.removeRule(tenantId, id);
  }
}
