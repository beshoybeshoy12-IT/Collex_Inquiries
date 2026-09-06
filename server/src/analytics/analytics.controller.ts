import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Everything the coordinator dashboard renders, in one response.
   *
   * The figures are already narrowed to what this user may see — see
   * `AnalyticsService.scope` — so the dashboard cannot become a side channel
   * for the cases the list view is filtering out.
   */
  @Get()
  @RequirePermission(P.DASHBOARD_VIEW)
  @ApiOperation({ summary: 'Case counts, SLA compliance, QC rates and volume' })
  dashboard(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.dashboard(tenantId, user, from, to);
  }

  @Get('investigator-productivity')
  @RequirePermission(P.ANALYTICS_VIEW, P.INVESTIGATORS_VIEW_PERFORMANCE)
  @ApiOperation({ summary: 'Assigned versus completed per investigator' })
  productivity(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.investigatorProductivity(tenantId, from, to);
  }
}
