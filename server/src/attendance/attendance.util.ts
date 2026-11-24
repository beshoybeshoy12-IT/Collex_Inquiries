/**
 * The arithmetic of office attendance. Pure, so every rule is pinned by a test
 * without a database.
 *
 * THE IDLE RULE. The browser reports activity (a heartbeat) only while the
 * person is actually using the system. When activity resumes after a silence
 * longer than the company's threshold, the WHOLE silence is idle time — not
 * just the part past the threshold. Fifteen minutes of nothing is fifteen
 * minutes away, and counting only the overshoot would credit everybody with a
 * free quarter hour per break. A silence shorter than the threshold is work:
 * reading a file, a phone call, thinking.
 *
 * Closed sessions have had their last silence settled at check-out; an open
 * session's current silence is shown live but not stored until it ends.
 */

export const DEFAULT_IDLE_MINUTES = 15;
export const MIN_IDLE_MINUTES = 5;
export const MAX_IDLE_MINUTES = 120;

export interface SessionClock {
  checkInAt: Date;
  checkOutAt: Date | null;
  lastActivityAt: Date;
  idleSeconds: number;
  idlePeriods: number;
}

/** What a silence from `lastActivityAt` to `at` adds to the idle totals. */
export function settleSilence(
  session: Pick<SessionClock, 'lastActivityAt' | 'idleSeconds' | 'idlePeriods'>,
  at: Date,
  idleMinutes: number,
): { idleSeconds: number; idlePeriods: number } {
  const gap = Math.floor(
    (at.getTime() - session.lastActivityAt.getTime()) / 1000,
  );
  if (gap > idleMinutes * 60) {
    return {
      idleSeconds: session.idleSeconds + gap,
      idlePeriods: session.idlePeriods + 1,
    };
  }
  return {
    idleSeconds: session.idleSeconds,
    idlePeriods: session.idlePeriods,
  };
}

/** Totals for one session, live for an open one. All in seconds. */
export function summarize(
  session: SessionClock,
  now: Date,
  idleMinutes: number,
): {
  totalSeconds: number;
  idleSeconds: number;
  workedSeconds: number;
  /** True when the open session is in an idle stretch right now. */
  idleNow: boolean;
} {
  const end = session.checkOutAt ?? now;
  const totalSeconds = Math.max(
    0,
    Math.floor((end.getTime() - session.checkInAt.getTime()) / 1000),
  );

  let idleSeconds = session.idleSeconds;
  let idleNow = false;
  if (!session.checkOutAt) {
    const settled = settleSilence(session, now, idleMinutes);
    idleNow = settled.idleSeconds > session.idleSeconds;
    idleSeconds = settled.idleSeconds;
  }
  idleSeconds = Math.min(idleSeconds, totalSeconds);

  return {
    totalSeconds,
    idleSeconds,
    workedSeconds: totalSeconds - idleSeconds,
    idleNow,
  };
}

/**
 * The calendar day of an instant in the company's timezone, as YYYY-MM-DD.
 * A check-in at 01:00 Cairo time is that Cairo day, whatever UTC says.
 */
export function workDayOf(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The idle threshold from the tenant settings JSON, clamped to sane bounds. */
export function idleMinutesFrom(settings: unknown): number {
  const raw = (settings as { attendanceIdleMinutes?: unknown } | null)
    ?.attendanceIdleMinutes;
  const value = typeof raw === 'number' ? Math.round(raw) : NaN;
  if (!Number.isFinite(value)) return DEFAULT_IDLE_MINUTES;
  return Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, value));
}
