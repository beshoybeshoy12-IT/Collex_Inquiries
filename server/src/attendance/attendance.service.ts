import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceSession, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  idleMinutesFrom,
  settleSilence,
  summarize,
  workDayOf,
} from './attendance.util';
import { buildAttendanceWorkbook } from './attendance-report';

interface Context {
  timeZone: string;
  idleMinutes: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Office attendance — check-in, check-out, and idle time.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Web users only, and always the caller's own record: the user id comes
 *  from the token, so "check somebody else in" has nowhere to be expressed.
 *
 *  A session left open past its day (the browser closed, nobody checked out)
 *  is closed by the system at its last moment of activity the next time that
 *  person touches attendance, and marked `autoClosed` so a report can show
 *  it. Closing it at "now" would credit a night's sleep as a shift.
 *
 *  The idle rule and its reasoning are in `attendance.util.ts`.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async context(tenantId: string): Promise<Context> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, settings: true },
    });
    return {
      timeZone: tenant?.timezone ?? 'Africa/Cairo',
      idleMinutes: idleMinutesFrom(tenant?.settings),
    };
  }

  /** The open session, after closing it if it belongs to an earlier day. */
  private async openSession(
    tenantId: string,
    userId: string,
    ctx: Context,
    now: Date,
  ): Promise<AttendanceSession | null> {
    const open = await this.prisma.attendanceSession.findFirst({
      where: { tenantId, userId, checkOutAt: null },
    });
    if (!open) return null;

    if (
      workDayOf(open.checkInAt, ctx.timeZone) !== workDayOf(now, ctx.timeZone)
    ) {
      await this.prisma.attendanceSession.update({
        where: { id: open.id },
        data: { checkOutAt: open.lastActivityAt, autoClosed: true },
      });
      return null;
    }
    return open;
  }

  /** Today for the caller: every session, the open one, and the totals. */
  async today(tenantId: string, userId: string) {
    const now = new Date();
    const ctx = await this.context(tenantId);
    const open = await this.openSession(tenantId, userId, ctx, now);
    const day = workDayOf(now, ctx.timeZone);

    const sessions = await this.prisma.attendanceSession.findMany({
      where: { tenantId, userId, workDate: asDate(day) },
      orderBy: { checkInAt: 'asc' },
    });

    const rows = sessions.map((session) => ({
      id: session.id,
      checkInAt: session.checkInAt,
      checkOutAt: session.checkOutAt,
      autoClosed: session.autoClosed,
      idlePeriods: session.idlePeriods,
      ...summarize(session, now, ctx.idleMinutes),
    }));

    return {
      day,
      serverNow: now,
      idleMinutes: ctx.idleMinutes,
      open: open ? (rows.find((row) => row.id === open.id) ?? null) : null,
      firstCheckInAt: rows[0]?.checkInAt ?? null,
      lastCheckOutAt: open ? null : (rows.at(-1)?.checkOutAt ?? null),
      sessions: rows,
      totals: totalsOf(rows),
    };
  }

  async checkIn(tenantId: string, userId: string, fullName: string) {
    const now = new Date();
    const ctx = await this.context(tenantId);

    if (await this.openSession(tenantId, userId, ctx, now)) {
      throw new ConflictException(
        'تم تسجيل الحضور بالفعل - You are already checked in',
      );
    }

    try {
      await this.prisma.attendanceSession.create({
        data: {
          tenantId,
          userId,
          workDate: asDate(workDayOf(now, ctx.timeZone)),
          checkInAt: now,
          lastActivityAt: now,
        },
      });
    } catch (error) {
      // Two clicks racing: the partial unique index caught the second.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'تم تسجيل الحضور بالفعل - You are already checked in',
        );
      }
      throw error;
    }

    await this.audit.log({
      tenantId,
      action: 'ATTENDANCE_CHECK_IN',
      category: 'USER',
      actorId: userId,
      actorName: fullName,
      entityType: 'User',
      entityId: userId,
      entityLabel: fullName,
    });
    this.signal(tenantId, userId);

    return this.today(tenantId, userId);
  }

  async checkOut(tenantId: string, userId: string, fullName: string) {
    const now = new Date();
    const ctx = await this.context(tenantId);
    const open = await this.openSession(tenantId, userId, ctx, now);
    if (!open) {
      throw new NotFoundException(
        'لا يوجد تسجيل حضور مفتوح - You are not checked in',
      );
    }

    // The silence running up to the click is settled first: a person who
    // walked away for an hour and checks out on return was idle for that hour.
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: {
        ...settleSilence(open, now, ctx.idleMinutes),
        checkOutAt: now,
        lastActivityAt: now,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'ATTENDANCE_CHECK_OUT',
      category: 'USER',
      actorId: userId,
      actorName: fullName,
      entityType: 'User',
      entityId: userId,
      entityLabel: fullName,
    });
    this.signal(tenantId, userId);

    return this.today(tenantId, userId);
  }

  /**
   * "I am using the system right now." Sent by the browser about once a
   * minute, and only while there has been real input.
   */
  async heartbeat(tenantId: string, userId: string) {
    const now = new Date();
    const ctx = await this.context(tenantId);
    const open = await this.openSession(tenantId, userId, ctx, now);
    if (!open) return { open: false };

    const settled = settleSilence(open, now, ctx.idleMinutes);
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: { ...settled, lastActivityAt: now },
    });

    return {
      open: true,
      resumedFromIdle: settled.idlePeriods > open.idlePeriods,
    };
  }

  /** Everybody for one day — `attendance.view_all`. */
  async team(tenantId: string, date?: string) {
    const now = new Date();
    const ctx = await this.context(tenantId);
    const day =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : workDayOf(now, ctx.timeZone);

    const [users, sessions] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, deletedAt: null, status: UserStatus.ACTIVE },
        select: {
          id: true,
          fullName: true,
          avatarKey: true,
          role: { select: { nameAr: true, nameEn: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.attendanceSession.findMany({
        where: { tenantId, workDate: asDate(day) },
        orderBy: { checkInAt: 'asc' },
      }),
    ]);

    const byUser = new Map<string, AttendanceSession[]>();
    for (const session of sessions) {
      byUser.set(session.userId, [
        ...(byUser.get(session.userId) ?? []),
        session,
      ]);
    }

    const rows = users.map((user) => {
      const own = byUser.get(user.id) ?? [];
      const summaries = own.map((s) => summarize(s, now, ctx.idleMinutes));
      const open = own.find((s) => !s.checkOutAt) ?? null;
      return {
        userId: user.id,
        fullName: user.fullName,
        role: user.role,
        status: open ? 'IN' : own.length ? 'OUT' : 'ABSENT',
        idleNow: open ? summarize(open, now, ctx.idleMinutes).idleNow : false,
        firstCheckInAt: own[0]?.checkInAt ?? null,
        lastCheckOutAt: open ? null : (own.at(-1)?.checkOutAt ?? null),
        sessions: own.length,
        idlePeriods: own.reduce((sum, s) => sum + s.idlePeriods, 0),
        autoClosed: own.some((s) => s.autoClosed),
        totals: totalsOf(summaries),
      };
    });

    return {
      day,
      idleMinutes: ctx.idleMinutes,
      counts: {
        in: rows.filter((r) => r.status === 'IN').length,
        out: rows.filter((r) => r.status === 'OUT').length,
        absent: rows.filter((r) => r.status === 'ABSENT').length,
      },
      rows,
    };
  }

  /** The company's idle threshold, merged into the settings JSON. */
  /**
   * The Excel report for a period — `attendance.view_all`. At most 92 days:
   * a quarter is the longest period anyone reviews in one sheet, and the
   * bound keeps one request from reading a year of sessions.
   */
  async exportRange(
    tenantId: string,
    from: string,
    to: string,
    language: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!valid(from) || !valid(to) || from > to) {
      throw new BadRequestException('فترة غير صالحة - Invalid period');
    }
    const spanDays =
      (asDate(to).getTime() - asDate(from).getTime()) / 86_400_000 + 1;
    if (spanDays > 92) {
      throw new BadRequestException(
        'الحد الأقصى 92 يومًا - The period may be at most 92 days',
      );
    }

    const now = new Date();
    const ctx = await this.context(tenantId);
    const sessions = await this.prisma.attendanceSession.findMany({
      where: { tenantId, workDate: { gte: asDate(from), lte: asDate(to) } },
      orderBy: { checkInAt: 'asc' },
    });

    // Everyone active, plus anyone who attended in the period and has since
    // left — their hours still belong in the report.
    const attendedIds = [...new Set(sessions.map((s) => s.userId))];
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        OR: [
          { deletedAt: null, status: UserStatus.ACTIVE },
          { id: { in: attendedIds } },
        ],
      },
      select: {
        id: true,
        fullName: true,
        role: { select: { nameAr: true, nameEn: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    const roleName = (role: { nameAr: string; nameEn: string } | null) =>
      role ? (language === 'en' ? role.nameEn : role.nameAr) : '';
    const userById = new Map(users.map((u) => [u.id, u]));

    const grouped = new Map<string, AttendanceSession[]>();
    for (const session of sessions) {
      const key = `${session.userId}|${session.workDate.toISOString().slice(0, 10)}`;
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }

    const days = [...grouped.entries()].map(([key, own]) => {
      const [userId, day] = key.split('|');
      const user = userById.get(userId);
      const totals = totalsOf(
        own.map((s) => summarize(s, now, ctx.idleMinutes)),
      );
      const open = own.some((s) => !s.checkOutAt);
      return {
        userId,
        day,
        fullName: user?.fullName ?? '',
        role: roleName(user?.role ?? null),
        firstCheckInAt: own[0].checkInAt,
        lastCheckOutAt: open ? null : (own.at(-1)?.checkOutAt ?? null),
        open,
        sessions: own.length,
        workedSeconds: totals.workedSeconds,
        idleSeconds: totals.idleSeconds,
        idlePeriods: own.reduce((sum, s) => sum + s.idlePeriods, 0),
        autoClosed: own.some((s) => s.autoClosed),
      };
    });

    const buffer = buildAttendanceWorkbook({
      from,
      to,
      timeZone: ctx.timeZone,
      language,
      people: users.map((u) => ({
        userId: u.id,
        fullName: u.fullName,
        role: roleName(u.role),
      })),
      days,
    });

    return { buffer, filename: `attendance-${from}_${to}.xlsx` };
  }

  async updateSettings(tenantId: string, idleMinutes: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = {
      ...((tenant?.settings as Record<string, unknown> | null) ?? {}),
      attendanceIdleMinutes: idleMinutes,
    };
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings },
    });

    await this.audit.log({
      tenantId,
      action: 'ATTENDANCE_SETTINGS_UPDATED',
      category: 'SETTINGS',
      severity: 'NOTICE',
      entityType: 'Tenant',
      entityId: tenantId,
      newValue: { attendanceIdleMinutes: idleMinutes },
    });

    return { idleMinutes: idleMinutesFrom(settings) };
  }

  /** Signal only — the team screen refetches behind its permission. */
  private signal(tenantId: string, userId: string) {
    this.realtime.emitToTenant(tenantId, 'attendance:changed', { userId });
  }
}

function asDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function totalsOf(
  rows: Array<{
    totalSeconds: number;
    idleSeconds: number;
    workedSeconds: number;
  }>,
) {
  return rows.reduce(
    (sum, row) => ({
      totalSeconds: sum.totalSeconds + row.totalSeconds,
      idleSeconds: sum.idleSeconds + row.idleSeconds,
      workedSeconds: sum.workedSeconds + row.workedSeconds,
    }),
    { totalSeconds: 0, idleSeconds: 0, workedSeconds: 0 },
  );
}
