import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import { GpsService } from './gps.service';
import { RecordGpsEventDto } from './dto/gps.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedPrincipal,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

@ApiTags('gps')
@ApiBearerAuth()
@Controller({ path: 'gps', version: '1' })
export class GpsController {
  constructor(private readonly gps: GpsService) {}

  /** The mobile client's check-in, check-out and photo-capture fixes. */
  @Post('events')
  @AllowPrincipals(PrincipalType.INVESTIGATOR, PrincipalType.WEB_USER)
  @ApiOperation({ summary: 'Record a position event (mobile client)' })
  record(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RecordGpsEventDto,
  ) {
    return this.gps.record(tenantId, principal, dto);
  }

  @Get('investigation/:investigationId')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.INVESTIGATIONS_VIEW, P.QC_VIEW)
  @ApiOperation({ summary: 'The GPS track for one case' })
  forInvestigation(
    @TenantId() tenantId: string,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
  ) {
    return this.gps.forInvestigation(tenantId, investigationId);
  }

  /**
   * An investigator's movement over a period. Gated on the location permission
   * rather than on `investigators.view`, for the same reason the live map is:
   * this is surveillance-adjacent data about an employee.
   */
  @Get('investigator/:investigatorId')
  @RequirePermission(P.INVESTIGATORS_VIEW_LOCATION)
  @ApiOperation({ summary: 'One investigator’s track over a period' })
  track(
    @TenantId() tenantId: string,
    @Param('investigatorId', ParseUUIDPipe) investigatorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const end = to ? new Date(to) : new Date();
    const start = from
      ? new Date(from)
      : new Date(end.getTime() - 24 * 3_600_000);

    return this.gps.trackForInvestigator(tenantId, investigatorId, start, end);
  }
}
