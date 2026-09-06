import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesService } from '../roles/roles.service';
import { RequirePermission } from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/permissions`
 *
 * The catalogue the permission matrix renders from. Read-only and global —
 * permissions are a property of the software, not of a tenant, so there is no
 * create endpoint and no tenant scoping.
 */
@ApiTags('permissions')
@ApiBearerAuth()
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission(P.ROLES_VIEW, P.USERS_VIEW)
  @ApiOperation({ summary: 'Every permission this build understands' })
  catalog() {
    return this.roles.catalog();
  }
}
