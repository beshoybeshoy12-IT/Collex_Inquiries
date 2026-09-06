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
import { UsersService } from './users.service';
import {
  CreateUserDto,
  SetUserPermissionsDto,
  SetUserStatusDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';
import {
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/users` — web platform users only.
 *
 * Field investigators live at `/api/v1/investigators` and are a different
 * table, a different login and a different screen. Nothing here reads or
 * writes an investigator.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission(P.USERS_VIEW)
  @ApiOperation({ summary: 'List web users' })
  findAll(@TenantId() tenantId: string, @Query() query: UserQueryDto) {
    return this.users.findAll(tenantId, query);
  }

  @Get(':id')
  @RequirePermission(P.USERS_VIEW)
  @ApiOperation({ summary: 'One user, with role and permission overrides' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.findOne(tenantId, id);
  }

  @Get(':id/activity')
  @RequirePermission(P.USERS_VIEW_ACTIVITY)
  @ApiOperation({ summary: 'Login history and live sessions' })
  activity(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.activity(tenantId, id);
  }

  @Post()
  @RequirePermission(P.USERS_CREATE)
  @ApiOperation({
    summary: 'Create a user; returns a generated password exactly once',
  })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ) {
    return this.users.create(tenantId, actor, dto);
  }

  @Patch(':id')
  @RequirePermission(P.USERS_EDIT)
  @ApiOperation({ summary: 'Edit a user' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(tenantId, actor, id, dto);
  }

  @Patch(':id/status')
  @RequirePermission(P.USERS_DISABLE)
  @ApiOperation({ summary: 'Enable or disable a user' })
  setStatus(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
  ) {
    return this.users.setStatus(tenantId, actor, id, dto.status, dto.reason);
  }

  @Post(':id/unlock')
  @RequirePermission(P.USERS_EDIT)
  @ApiOperation({ summary: 'Clear a lockout after failed sign-ins' })
  unlock(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.unlock(tenantId, actor, id);
  }

  @Post(':id/reset-password')
  @RequirePermission(P.USERS_RESET_PASSWORD)
  @ApiOperation({
    summary: 'Issue a new generated password and end every session',
  })
  resetPassword(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.resetPassword(tenantId, actor, id);
  }

  @Post(':id/revoke-sessions')
  @RequirePermission(P.USERS_MANAGE_SESSIONS)
  @ApiOperation({ summary: 'Sign a user out of every device' })
  revokeSessions(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.revokeSessions(tenantId, actor, id);
  }

  @Patch(':id/permissions')
  @RequirePermission(P.PERMISSIONS_ASSIGN)
  @ApiOperation({ summary: 'Per-user permission grants and denies' })
  setPermissions(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserPermissionsDto,
  ) {
    return this.users.setPermissions(tenantId, actor, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.USERS_DELETE)
  @ApiOperation({ summary: 'Soft-delete a user and end their sessions' })
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.remove(tenantId, actor, id);
  }
}
