import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import {
  CreateTenantDto,
  SetTenantLimitsDto,
  SetTenantStatusDto,
  UpdateTenantDto,
  UpdateTenantSettingsDto,
} from './dto/tenant.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/tenants`
 *
 * The platform-operator routes are gated on `isSuperAdmin` in code rather than
 * on a permission. That is deliberate: a permission is something a tenant
 * administrator could plausibly be granted one day by somebody trying to be
 * helpful, and "create tenants" and "raise your own plan limits" must never be
 * reachable that way. `isSuperAdmin` has no API that can set it.
 */
@ApiTags('tenants')
@ApiBearerAuth()
@Controller({ path: 'tenants', version: '1' })
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  private assertPlatformOperator(user: AuthenticatedUser): void {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException(
        'هذا الإجراء متاح لمشغل المنصة فقط - ' +
          'This action is available to platform operators only',
      );
    }
  }

  // ── The caller's own company ────────────────────────────────────────────

  @Get('me')
  @RequirePermission(P.SETTINGS_VIEW, P.TENANT_MANAGE)
  @ApiOperation({ summary: 'Your own company profile and plan usage' })
  getOwn(@TenantId() tenantId: string) {
    return this.tenants.getOwn(tenantId);
  }

  @Patch('me')
  @RequirePermission(P.TENANT_MANAGE)
  @ApiOperation({ summary: 'Edit your own company profile' })
  updateOwn(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.tenants.updateOwn(tenantId, user, dto);
  }

  @Patch('me/settings')
  @RequirePermission(P.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Feature flags, locale and timezone' })
  updateSettings(
    @TenantId() tenantId: string,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    return this.tenants.updateSettings(tenantId, dto);
  }

  // ── Platform operator ───────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Every tenant (platform operator only)' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    this.assertPlatformOperator(user);
    return this.tenants.findAll();
  }

  @Post()
  @ApiOperation({
    summary: 'Provision a tenant with roles and a first administrator',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTenantDto) {
    this.assertPlatformOperator(user);
    return this.tenants.create(dto);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Suspend, expire or reactivate a tenant; ends its sessions',
  })
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTenantStatusDto,
  ) {
    this.assertPlatformOperator(user);
    return this.tenants.setStatus(id, dto.status, dto.reason);
  }

  @Patch(':id/limits')
  @ApiOperation({ summary: 'Plan limits and subscription window' })
  setLimits(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTenantLimitsDto,
  ) {
    this.assertPlatformOperator(user);
    return this.tenants.setLimits(id, dto);
  }
}
