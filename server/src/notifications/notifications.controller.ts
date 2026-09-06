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
  constructor(private readonly notifications: NotificationsService) {}

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
