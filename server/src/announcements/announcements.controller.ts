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
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/announcements` — office staff.
 *
 * Reading and marking read need no permission; what a reader sees is narrowed
 * by audience in the service. Publishing is `announcements.manage`.
 */
@ApiTags('announcements')
@ApiBearerAuth()
@AllowPrincipals(PrincipalType.WEB_USER)
@Controller({ path: 'announcements', version: '1' })
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'Announcements visible to you' })
  feed(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.announcements.feed(tenantId, user, includeExpired === 'true');
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark an announcement as read' })
  markRead(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.markRead(tenantId, user, id);
  }

  @Get(':id/readers')
  @RequirePermission(P.ANNOUNCEMENTS_MANAGE)
  @ApiOperation({ summary: 'Who has read an announcement' })
  readers(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.readers(tenantId, id);
  }

  @Post()
  @RequirePermission(P.ANNOUNCEMENTS_MANAGE)
  @ApiOperation({ summary: 'Publish an announcement' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcements.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequirePermission(P.ANNOUNCEMENTS_MANAGE)
  @ApiOperation({ summary: 'Edit an announcement' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcements.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.ANNOUNCEMENTS_MANAGE)
  @ApiOperation({ summary: 'Remove an announcement' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.remove(tenantId, id);
  }
}
