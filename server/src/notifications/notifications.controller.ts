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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { NotificationsService } from './notifications.service';
import { PushService } from '../push/push.service';
import { RegisterDeviceDto } from '../push/dto/device.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedPrincipal,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

class BroadcastDto {
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  roleCodes: string[];

  @IsString()
  @MaxLength(160)
  titleAr: string;

  @IsString()
  @MaxLength(160)
  titleEn: string;

  @IsString()
  @MaxLength(1000)
  bodyAr: string;

  @IsString()
  @MaxLength(1000)
  bodyEn: string;
}

/**
 * `/api/v1/notifications`
 *
 * Every route here reads or writes the *caller's own* inbox. There is no
 * parameter anywhere for whose notifications to fetch, and no permission
 * gating the personal routes — the resource is the caller, so authentication
 * is the whole authorization story. Broadcast is the one exception and is
 * gated accordingly.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Devices
  //
  //  Registration is its own route rather than a field on login, because a
  //  provider token ROTATES on the provider's schedule — FCM reissues without
  //  being asked, mid-session, with no login to hang the update on. A token
  //  captured only at sign-in goes stale silently, and the symptom is a
  //  notification that never arrives while everything looks healthy.
  //
  //  Declared before the parameterised routes below: `devices` would otherwise
  //  be matched by `@Delete(':id')` as a uuid and rejected by ParseUUIDPipe.
  // ─────────────────────────────────────────────────────────────────────────

  @Post('devices')
  @ApiOperation({
    summary: 'Register this handset for push, or move it to this account',
  })
  registerDevice(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.push.register(tenantId, principal, dto);
  }

  @Get('devices')
  @ApiOperation({
    summary: 'Handsets you have registered. Tokens are never returned.',
  })
  listDevices(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.push.listForPrincipal(tenantId, principal);
  }

  @Delete('devices/:token')
  @ApiOperation({
    summary: 'Unregister a handset — call this on sign-out',
  })
  unregisterDevice(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('token') token: string,
  ) {
    // No ParseUUIDPipe: a provider token is not a uuid. Ownership is the
    // filter, and a token that is not the caller's reports zero removed rather
    // than 404 — confirming a token exists is an oracle with no use.
    return this.push.unregister(tenantId, principal, token);
  }

  @Get()
  @ApiOperation({ summary: 'Your own notifications' })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notifications.listForPrincipal(
      tenantId,
      principal.id,
      principal.principalType,
      query,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of your notifications are unread' })
  async unreadCount(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return {
      unread: await this.notifications.unreadCount(
        tenantId,
        principal.id,
        principal.principalType,
      ),
    };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one of your notifications as read' })
  markRead(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(
      tenantId,
      principal.id,
      principal.principalType,
      id,
    );
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark everything in your inbox as read' })
  markAllRead(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.notifications.markAllRead(
      tenantId,
      principal.id,
      principal.principalType,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one of your notifications' })
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.remove(
      tenantId,
      principal.id,
      principal.principalType,
      id,
    );
  }

  @Post('broadcast')
  @AllowPrincipals(PrincipalType.WEB_USER)
  @RequirePermission(P.NOTIFICATIONS_BROADCAST)
  @ApiOperation({ summary: 'Send a notification to everyone holding a role' })
  async broadcast(@TenantId() tenantId: string, @Body() dto: BroadcastDto) {
    const recipients = await this.notifications.notifyRoles(
      tenantId,
      dto.roleCodes,
      {
        type: 'SYSTEM',
        titleAr: dto.titleAr,
        titleEn: dto.titleEn,
        bodyAr: dto.bodyAr,
        bodyEn: dto.bodyEn,
      },
    );
    return { recipients };
  }
}
