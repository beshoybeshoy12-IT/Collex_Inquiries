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
import { PrincipalType } from '@prisma/client';
import { InvestigatorsService } from './investigators.service';
import {
  CreateInvestigatorDto,
  InvestigatorQueryDto,
  SetInvestigatorStatusDto,
  UpdateAvailabilityDto,
  UpdateInvestigatorDto,
  UpdateLocationDto,
} from './dto/investigator.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedInvestigator,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/investigators`
 *
 * LOCATION IS A SEPARATE PERMISSION, and this controller is where that shows.
 * A coordinator who needs to see workloads to assign work does not
 * automatically need to see where an employee is standing — so the position
 * columns are only selected when the caller holds
 * `investigators.view_location`, rather than being fetched and filtered in the
 * response. A column that is never read cannot leak.
 */
@ApiTags('investigators')
@ApiBearerAuth()
@Controller({ path: 'investigators', version: '1' })
export class InvestigatorsController {
  constructor(private readonly investigators: InvestigatorsService) {}

  private canSeeLocation(user: AuthenticatedUser): boolean {
    return (
      user.isSuperAdmin ||
      user.permissions.includes(P.INVESTIGATORS_VIEW_LOCATION)
    );
  }

  @Get()
  @RequirePermission(P.INVESTIGATORS_VIEW)
  @ApiOperation({ summary: 'List field investigators with their workload' })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InvestigatorQueryDto,
  ) {
    return this.investigators.findAll(
      tenantId,
      query,
      this.canSeeLocation(user),
    );
  }

  @Get('live-map')
  @RequirePermission(P.INVESTIGATORS_VIEW_LOCATION)
  @ApiOperation({ summary: 'Live positions of active investigators' })
  liveMap(@TenantId() tenantId: string) {
    return this.investigators.liveMap(tenantId);
  }

  @Get(':id')
  @RequirePermission(P.INVESTIGATORS_VIEW)
  @ApiOperation({ summary: 'One investigator' })
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.investigators.findOne(tenantId, id, this.canSeeLocation(user));
  }

  @Get(':id/performance')
  @RequirePermission(P.INVESTIGATORS_VIEW_PERFORMANCE)
  @ApiOperation({ summary: 'Quality, SLA compliance and turnaround' })
  performance(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.investigators.performance(
      tenantId,
      id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Post()
  @RequirePermission(P.INVESTIGATORS_CREATE)
  @ApiOperation({
    summary: 'Create an investigator; returns a generated password once',
  })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateInvestigatorDto,
  ) {
    return this.investigators.create(tenantId, actor, dto);
  }

  @Patch(':id')
  @RequirePermission(P.INVESTIGATORS_EDIT)
  @ApiOperation({ summary: 'Edit an investigator' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestigatorDto,
  ) {
    return this.investigators.update(tenantId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermission(P.INVESTIGATORS_DISABLE)
  @ApiOperation({
    summary: 'Change employment status; refuses while cases are open',
  })
  setStatus(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetInvestigatorStatusDto,
  ) {
    return this.investigators.setStatus(tenantId, id, dto.status, dto.reason);
  }

  @Post(':id/reset-password')
  @RequirePermission(P.INVESTIGATORS_RESET_PASSWORD)
  @ApiOperation({ summary: 'Issue a new password and end every session' })
  resetPassword(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.investigators.resetPassword(tenantId, id);
  }

  @Delete(':id')
  @RequirePermission(P.INVESTIGATORS_DELETE)
  @ApiOperation({ summary: 'Soft-delete an investigator with no open cases' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.investigators.remove(tenantId, id);
  }

  // ── The investigator's own routes (mobile client) ───────────────────────

  /**
   * These two take the investigator id from the token, never from the path.
   * "Set somebody else's availability" and "report somebody else's position"
   * are requests with nowhere to be expressed.
   */
  @Patch('me/availability')
  @AllowPrincipals(PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Set your own availability (mobile client)' })
  setOwnAvailability(
    @TenantId() tenantId: string,
    @CurrentUser() investigator: AuthenticatedInvestigator,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.investigators.setOwnAvailability(
      tenantId,
      investigator.id,
      dto,
    );
  }

  @Post('me/location')
  @AllowPrincipals(PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Report your own position (mobile client)' })
  reportLocation(
    @TenantId() tenantId: string,
    @CurrentUser() investigator: AuthenticatedInvestigator,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.investigators.reportLocation(tenantId, investigator.id, dto);
  }
}
