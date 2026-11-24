import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { UpdateAttendanceSettingsDto } from './dto/attendance.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/attendance` — office staff only.
 *
 * The `me/*` routes need no permission: recording your own attendance is
 * part of being signed in, like your profile. Seeing everybody's is
 * `attendance.view_all`; the idle threshold is a company setting.
 */
@ApiTags('attendance')
@ApiBearerAuth()
@AllowPrincipals(PrincipalType.WEB_USER)
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('me/today')
  @ApiOperation({ summary: 'Your attendance today, with live totals' })
  today(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendance.today(tenantId, user.id);
  }

  @Post('me/check-in')
  @ApiOperation({ summary: 'Check in' })
  checkIn(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.checkIn(tenantId, user.id, user.fullName);
  }

  @Post('me/check-out')
  @ApiOperation({ summary: 'Check out' })
  checkOut(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.checkOut(tenantId, user.id, user.fullName);
  }

  @Post('me/heartbeat')
  @ApiOperation({
    summary: 'Report activity (sent by the browser while in use)',
  })
  heartbeat(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.heartbeat(tenantId, user.id);
  }

  @Get('team')
  @RequirePermission(P.ATTENDANCE_VIEW_ALL)
  @ApiOperation({ summary: 'Everybody’s attendance for one day' })
  team(@TenantId() tenantId: string, @Query('date') date?: string) {
    return this.attendance.team(tenantId, date);
  }

  @Get('team/export')
  @RequirePermission(P.ATTENDANCE_VIEW_ALL)
  @ApiOperation({ summary: 'Excel attendance report for a period' })
  async exportTeam(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('lang') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer } = await this.attendance.exportRange(
      tenantId,
      from,
      to,
      lang === 'en' || lang === 'ar' ? lang : user.locale,
    );
    // Opaque bytes and no file name: a desktop download manager would grab an
    // xlsx attachment and leave the page an empty reply. The client names it.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(buffer);
  }

  @Patch('settings')
  @RequirePermission(P.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Set the company idle threshold' })
  updateSettings(
    @TenantId() tenantId: string,
    @Body() dto: UpdateAttendanceSettingsDto,
  ) {
    return this.attendance.updateSettings(tenantId, dto.idleMinutes);
  }
}
