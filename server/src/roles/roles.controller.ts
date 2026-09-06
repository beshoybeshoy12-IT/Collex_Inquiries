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
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

@ApiTags('roles')
@ApiBearerAuth()
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission(P.ROLES_VIEW)
  @ApiOperation({ summary: 'List roles with their grants and holder counts' })
  findAll(@TenantId() tenantId: string) {
    return this.roles.findAll(tenantId);
  }

  @Get(':id')
  @RequirePermission(P.ROLES_VIEW)
  @ApiOperation({ summary: 'One role' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roles.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission(P.ROLES_CREATE)
  @ApiOperation({ summary: 'Create a role' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoleDto,
  ) {
    return this.roles.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequirePermission(P.ROLES_EDIT, P.PERMISSIONS_ASSIGN)
  @ApiOperation({ summary: 'Edit a role, including its permission grants' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(tenantId, user, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.ROLES_DELETE)
  @ApiOperation({ summary: 'Delete a role nobody holds' })
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roles.remove(tenantId, user, id);
  }
}
