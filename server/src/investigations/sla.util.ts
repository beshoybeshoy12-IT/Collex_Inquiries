import { InvestigationStatus, SlaState } from '@prisma/client';
import { TERMINAL_STATUSES } from './case-status.machine';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TAT and SLA, computed and never stored.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `SlaState` is derived on read from the case's timestamps and its policy. It
 *  is deliberately not a column: a stored state is a value that has to be
 *  recomputed by something, and the moment that something misses a run, the
 *  badge on the screen disagrees with the dates next to it. Deriving costs
 *  arithmetic on rows already loaded.
 *
 *  BUSINESS HOURS. When a policy sets `businessHoursOnly`, the clock only runs
 *  during the configured workday on configured workdays. A case raised at
 *  4 p.m. on Thursday with an 8-hour SLA is not breached by Sunday morning
 *  because nobody was meant to be working — and a system that says otherwise
 *  trains its users to ignore the colour.
 */

export interface SlaPolicyShape {
  totalHours: number;
  assignmentHours: number;
  acceptanceHours: number;
  fieldHours: number;
  qcHours: number;
  warnAtPercent: number;
  businessHoursOnly: boolean;
  workdayStartHour: number;
  workdayEndHour: number;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workdays: number[];
}

export interface CaseTimeline {
  createdAt: Date;
  assignedAt?: Date | null;
  acceptedAt?: Date | null;
  startedAt?: Date | null;
  submittedAt?: Date | null;
  qcAt?: Date | null;
  completedAt?: Date | null;
  dueAt?: Date | null;
  status: InvestigationStatus;
}

export interface TatBreakdown {
  /** Minutes from creation to assignment. */
  assignmentMinutes: number | null;
  /** Minutes from assignment to the investigator accepting. */
  acceptanceMinutes: number | null;
  /** Minutes from acceptance to submission — the field leg. */
  investigationMinutes: number | null;
  /** Minutes from submission to a QC decision. */
  qcMinutes: number | null;
  /** Creation to completion, or to now for a case still running. */
  totalMinutes: number | null;
  /** True once the case is finished, so averages can exclude live cases. */
  isComplete: boolean;
}

export interface SlaAssessment {
  state: SlaState;
  dueAt: Date | null;
  /** Negative once past due. */
  minutesRemaining: number | null;
  /** 0–100+, how much of the budget has been consumed. */
  percentConsumed: number | null;
  breached: boolean;
}

const MINUTE = 60_000;

/** Whole minutes between two instants, floored, never negative. */
function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE));
}

/**
 * Working minutes between two instants.
 *
 * Walks day by day rather than minute by minute — a naive per-minute loop over
 * a two-week span is 20,000 iterations per case, and this runs for every row of
 * a 200-row case list.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  policy: Pick<
    SlaPolicyShape,
    'workdayStartHour' | 'workdayEndHour' | 'workdays'
  >,
): number {
  if (to <= from) return 0;

  const workdays = new Set(
    policy.workdays.length > 0 ? policy.workdays : [1, 2, 3, 4, 5],
  );
  const startHour = policy.workdayStartHour;
  const endHour = policy.workdayEndHour;
  if (endHour <= startHour) return minutesBetween(from, to);

  let total = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= to) {
    // getDay() is 0=Sunday; the policy uses ISO 1=Monday…7=Sunday.
    const isoDay = cursor.getDay() === 0 ? 7 : cursor.getDay();

    if (workdays.has(isoDay)) {
      const dayStart = new Date(cursor);
      dayStart.setHours(startHour, 0, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(endHour, 0, 0, 0);

      const windowStart = from > dayStart ? from : dayStart;
      const windowEnd = to < dayEnd ? to : dayEnd;

      if (windowEnd > windowStart) {
        total += minutesBetween(windowStart, windowEnd);
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

/** Elapsed minutes under a policy — business hours or wall clock. */
export function elapsedMinutes(
  from: Date,
  to: Date,
  policy?: SlaPolicyShape | null,
): number {
  if (policy?.businessHoursOnly) {
    return businessMinutesBetween(from, to, policy);
  }
  return minutesBetween(from, to);
}

/**
 * Add a budget of working hours to an instant, returning the deadline.
 *
 * Steps forward a day at a time consuming each workday's capacity — the same
 * shape as the counter above and for the same reason.
 */
export function addBusinessHours(
  start: Date,
  hours: number,
  policy: Pick<
    SlaPolicyShape,
    'workdayStartHour' | 'workdayEndHour' | 'workdays'
  >,
): Date {
  const workdays = new Set(
    policy.workdays.length > 0 ? policy.workdays : [1, 2, 3, 4, 5],
  );
  const dayCapacityMinutes =
    (policy.workdayEndHour - policy.workdayStartHour) * 60;
  if (dayCapacityMinutes <= 0) {
    return new Date(start.getTime() + hours * 60 * MINUTE);
  }

  let remaining = hours * 60;
  const cursor = new Date(start);

  // A guard against a policy with no workdays at all, which would otherwise
  // loop forever looking for a day that never comes.
  for (let guard = 0; guard < 3650 && remaining > 0; guard++) {
    const isoDay = cursor.getDay() === 0 ? 7 : cursor.getDay();

    if (workdays.has(isoDay)) {
      const dayStart = new Date(cursor);
      dayStart.setHours(policy.workdayStartHour, 0, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(policy.workdayEndHour, 0, 0, 0);

      const from = cursor > dayStart ? cursor : dayStart;

      if (from < dayEnd) {
        const available = minutesBetween(from, dayEnd);
        if (available >= remaining) {
          return new Date(from.getTime() + remaining * MINUTE);
        }
        remaining -= available;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(policy.workdayStartHour, 0, 0, 0);
  }

  return cursor;
}

/** The deadline for a case, from its start and its policy. */
export function computeDueAt(
  start: Date,
  policy: SlaPolicyShape | null | undefined,
): Date | null {
  if (!policy) return null;
  return policy.businessHoursOnly
    ? addBusinessHours(start, policy.totalHours, policy)
    : new Date(start.getTime() + policy.totalHours * 60 * MINUTE);
}

/**
 * Per-stage turnaround.
 *
 * Every figure is derived from two stamps and is null while the stage has not
 * happened, so an average over these never silently counts an unfinished stage
 * as zero.
 */
export function computeTat(
  timeline: CaseTimeline,
  policy?: SlaPolicyShape | null,
  now: Date = new Date(),
): TatBreakdown {
  const at = (value: Date | null | undefined) => value ?? null;

  const assigned = at(timeline.assignedAt);
  const accepted = at(timeline.acceptedAt);
  const submitted = at(timeline.submittedAt);
  const qc = at(timeline.qcAt);
  const completed = at(timeline.completedAt);

  const isComplete = TERMINAL_STATUSES.includes(timeline.status);

  return {
    assignmentMinutes: assigned
      ? elapsedMinutes(timeline.createdAt, assigned, policy)
      : null,
    acceptanceMinutes:
      assigned && accepted ? elapsedMinutes(assigned, accepted, policy) : null,
    investigationMinutes:
      accepted && submitted
        ? elapsedMinutes(accepted, submitted, policy)
        : null,
    qcMinutes: submitted && qc ? elapsedMinutes(submitted, qc, policy) : null,
    totalMinutes: elapsedMinutes(
      timeline.createdAt,
      completed ?? (isComplete ? now : now),
      policy,
    ),
    isComplete,
  };
}

/**
 * GREEN / YELLOW / RED, or the settled MET / BREACHED once the case is done.
 *
 * A finished case reports what actually happened rather than a live colour: a
 * completed case that took three days against a two-day SLA is BREACHED
 * forever, and showing it as RED — a state that implies "act now" — would put
 * it back on somebody's worklist.
 */
export function assessSla(
  timeline: CaseTimeline,
  policy: SlaPolicyShape | null | undefined,
  now: Date = new Date(),
): SlaAssessment {
  const dueAt =
    timeline.dueAt ?? computeDueAt(timeline.createdAt, policy) ?? null;

  if (!dueAt || !policy) {
    return {
      state: SlaState.NOT_APPLICABLE,
      dueAt: null,
      minutesRemaining: null,
      percentConsumed: null,
      breached: false,
    };
  }

  const settledAt = timeline.completedAt;
  if (settledAt) {
    const met = settledAt.getTime() <= dueAt.getTime();
    return {
      state: met ? SlaState.MET : SlaState.BREACHED,
      dueAt,
      minutesRemaining: Math.floor(
        (dueAt.getTime() - settledAt.getTime()) / MINUTE,
      ),
      percentConsumed: percentOf(timeline.createdAt, settledAt, dueAt, policy),
      breached: !met,
    };
  }

  // Cancelled and archived cases have no live obligation.
  if (TERMINAL_STATUSES.includes(timeline.status)) {
    return {
      state: SlaState.NOT_APPLICABLE,
      dueAt,
      minutesRemaining: null,
      percentConsumed: null,
      breached: false,
    };
  }

  const minutesRemaining = Math.floor(
    (dueAt.getTime() - now.getTime()) / MINUTE,
  );
  const percentConsumed = percentOf(timeline.createdAt, now, dueAt, policy);

  if (minutesRemaining < 0) {
    return {
      state: SlaState.RED,
      dueAt,
      minutesRemaining,
      percentConsumed,
      breached: true,
    };
  }

  const warnAt = policy.warnAtPercent > 0 ? policy.warnAtPercent : 80;
  return {
    state: percentConsumed >= warnAt ? SlaState.YELLOW : SlaState.GREEN,
    dueAt,
    minutesRemaining,
    percentConsumed,
    breached: false,
  };
}

function percentOf(
  start: Date,
  at: Date,
  due: Date,
  policy: SlaPolicyShape,
): number {
  const budget = elapsedMinutes(start, due, policy);
  if (budget <= 0) return 100;
  const used = elapsedMinutes(start, at, policy);
  return Math.round((used / budget) * 100);
}

/** A readable "2d 4h" for the case header. Minutes below an hour show as "45m". */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
