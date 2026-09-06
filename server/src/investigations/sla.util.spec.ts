import { InvestigationStatus, SlaState } from '@prisma/client';
import {
  addBusinessHours,
  assessSla,
  businessMinutesBetween,
  computeDueAt,
  computeTat,
  elapsedMinutes,
  formatDuration,
  SlaPolicyShape,
} from './sla.util';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SLA arithmetic.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  These functions decide what colour a case wears, which is the single most
 *  looked-at thing on the case list, and — through the escalation engine —
 *  whose phone rings at 3 a.m. The failure mode that matters is not a crash:
 *  it is a plausible-looking number that is quietly wrong, which nobody
 *  notices until a client asks why a case shows GREEN two days past its
 *  deadline.
 *
 *  The suite is written against a SUNDAY–THURSDAY working week (ISO 7,1,2,3,4),
 *  which is the Egyptian working week this system is built for, precisely
 *  because a Monday–Friday assumption is the bug most likely to survive
 *  review: every test here passes under a Mon–Fri policy too if you only
 *  check that the numbers are non-negative.
 *
 *  All dates are constructed with the local-time `new Date(y, m, d, h)` form,
 *  not ISO strings, because the implementation reads `getHours()` and
 *  `getDay()` in local time. Writing `2026-03-01T09:00:00Z` here would make
 *  the suite pass or fail depending on the machine's timezone.
 */

// Sunday-through-Thursday, 09:00–17:00. Eight-hour days.
const EGYPT_POLICY: SlaPolicyShape = {
  totalHours: 24,
  assignmentHours: 4,
  acceptanceHours: 2,
  fieldHours: 12,
  qcHours: 6,
  warnAtPercent: 80,
  businessHoursOnly: true,
  workdayStartHour: 9,
  workdayEndHour: 17,
  workdays: [7, 1, 2, 3, 4],
};

const ROUND_THE_CLOCK: SlaPolicyShape = {
  ...EGYPT_POLICY,
  totalHours: 24,
  businessHoursOnly: false,
};

// March 2026: the 1st is a Sunday, so the dates below line up as
//   1 Sun, 2 Mon, 3 Tue, 4 Wed, 5 Thu, 6 Fri (off), 7 Sat (off), 8 Sun.
const SUNDAY = (hour: number, minute = 0) => new Date(2026, 2, 1, hour, minute);
const MONDAY = (hour: number, minute = 0) => new Date(2026, 2, 2, hour, minute);
const TUESDAY = (hour: number, minute = 0) =>
  new Date(2026, 2, 3, hour, minute);
const THURSDAY = (hour: number, minute = 0) =>
  new Date(2026, 2, 5, hour, minute);
const FRIDAY = (hour: number, minute = 0) => new Date(2026, 2, 6, hour, minute);
const SATURDAY = (hour: number, minute = 0) =>
  new Date(2026, 2, 7, hour, minute);
const NEXT_SUNDAY = (hour: number, minute = 0) =>
  new Date(2026, 2, 8, hour, minute);

describe('sla.util', () => {
  it('the calendar assumptions this suite is built on actually hold', () => {
    // If March 2026 ever stops starting on a Sunday, every "weekend" test
    // below silently becomes a weekday test and proves nothing.
    expect(SUNDAY(9).getDay()).toBe(0);
    expect(THURSDAY(9).getDay()).toBe(4);
    expect(FRIDAY(9).getDay()).toBe(5);
    expect(SATURDAY(9).getDay()).toBe(6);
  });

  describe('businessMinutesBetween', () => {
    it('counts only the hours inside one workday', () => {
      // 10:00 → 15:00 on a Sunday is five hours, all of them in-window.
      expect(businessMinutesBetween(SUNDAY(10), SUNDAY(15), EGYPT_POLICY)).toBe(
        300,
      );
    });

    it('clips the part of the span that falls before the workday opens', () => {
      // 07:00 → 11:00 is four wall-clock hours but only two working ones.
      expect(businessMinutesBetween(SUNDAY(7), SUNDAY(11), EGYPT_POLICY)).toBe(
        120,
      );
    });

    it('clips the part that falls after the workday closes', () => {
      // 15:00 → 23:00 is eight wall-clock hours, two of them working.
      expect(businessMinutesBetween(SUNDAY(15), SUNDAY(23), EGYPT_POLICY)).toBe(
        120,
      );
    });

    it('counts nothing at all for a span entirely outside working hours', () => {
      expect(businessMinutesBetween(SUNDAY(19), SUNDAY(22), EGYPT_POLICY)).toBe(
        0,
      );
    });

    it('skips the weekend entirely', () => {
      // Thursday 16:00 → Sunday 10:00. Wall clock: 66 hours. Working: one hour
      // left on Thursday plus one on Sunday — Friday and Saturday are off.
      // A system that reported 66 hours here would breach every case raised on
      // a Thursday afternoon before anyone came back to work.
      expect(
        businessMinutesBetween(THURSDAY(16), NEXT_SUNDAY(10), EGYPT_POLICY),
      ).toBe(120);
    });

    it('counts a whole weekend as zero', () => {
      expect(
        businessMinutesBetween(FRIDAY(0), SATURDAY(23, 59), EGYPT_POLICY),
      ).toBe(0);
    });

    it('accumulates across several workdays', () => {
      // Sunday 09:00 → Tuesday 17:00 = three full 8-hour days.
      expect(businessMinutesBetween(SUNDAY(9), TUESDAY(17), EGYPT_POLICY)).toBe(
        3 * 8 * 60,
      );
    });

    it('returns zero when the range is inverted or empty', () => {
      expect(businessMinutesBetween(SUNDAY(15), SUNDAY(10), EGYPT_POLICY)).toBe(
        0,
      );
      expect(businessMinutesBetween(SUNDAY(10), SUNDAY(10), EGYPT_POLICY)).toBe(
        0,
      );
    });

    it('falls back to wall-clock minutes when the workday is misconfigured', () => {
      // end <= start is not a working day, it is a typo. Counting zero forever
      // would freeze every SLA at 0% and show a permanent GREEN; wall clock is
      // the safer wrong answer because it still moves.
      const broken = {
        ...EGYPT_POLICY,
        workdayStartHour: 17,
        workdayEndHour: 9,
      };
      expect(businessMinutesBetween(SUNDAY(10), SUNDAY(14), broken)).toBe(240);
    });

    it('treats an empty workdays list as Monday–Friday rather than never', () => {
      const noDays = { ...EGYPT_POLICY, workdays: [] };
      // Monday is a workday under the fallback; Sunday is not.
      expect(businessMinutesBetween(MONDAY(9), MONDAY(17), noDays)).toBe(480);
      expect(businessMinutesBetween(SUNDAY(9), SUNDAY(17), noDays)).toBe(0);
    });
  });

  describe('elapsedMinutes', () => {
    it('uses the wall clock when the policy is not business-hours-only', () => {
      expect(
        elapsedMinutes(THURSDAY(16), NEXT_SUNDAY(10), ROUND_THE_CLOCK),
      ).toBe(66 * 60);
    });

    it('uses the wall clock when there is no policy at all', () => {
      expect(elapsedMinutes(SUNDAY(10), SUNDAY(14), null)).toBe(240);
      expect(elapsedMinutes(SUNDAY(10), SUNDAY(14), undefined)).toBe(240);
    });
  });

  describe('addBusinessHours', () => {
    it('lands inside the same day when the budget fits', () => {
      expect(addBusinessHours(SUNDAY(10), 4, EGYPT_POLICY)).toEqual(SUNDAY(14));
    });

    it('rolls an overflowing budget into the next workday', () => {
      // 14:00 + 5h = three hours today, two tomorrow from 09:00.
      expect(addBusinessHours(SUNDAY(14), 5, EGYPT_POLICY)).toEqual(MONDAY(11));
    });

    it('starts the clock at opening time for a case raised before work', () => {
      // 06:00 is not working time; the budget starts at 09:00, not at 06:00.
      expect(addBusinessHours(SUNDAY(6), 2, EGYPT_POLICY)).toEqual(SUNDAY(11));
    });

    it('pushes a case raised after hours to the next morning', () => {
      expect(addBusinessHours(SUNDAY(22), 3, EGYPT_POLICY)).toEqual(MONDAY(12));
    });

    it('jumps the weekend', () => {
      // Thursday 16:00 + 4h: one hour left on Thursday, three more on Sunday.
      expect(addBusinessHours(THURSDAY(16), 4, EGYPT_POLICY)).toEqual(
        NEXT_SUNDAY(12),
      );
    });

    it('terminates rather than hanging when no day is a workday', () => {
      // A policy with no workdays has no answer. What it must not do is spin
      // forever inside a request — the guard caps the walk at ten years.
      const impossible = { ...EGYPT_POLICY, workdays: [] as number[] };
      // An empty list falls back to Mon–Fri, so use days that exist but are
      // never reachable: a single workday of zero length.
      const zeroLength = {
        ...EGYPT_POLICY,
        workdayStartHour: 9,
        workdayEndHour: 9,
      };
      const started = Date.now();
      const result = addBusinessHours(SUNDAY(10), 8, zeroLength);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(result).toBeInstanceOf(Date);
      expect(addBusinessHours(SUNDAY(10), 1, impossible)).toBeInstanceOf(Date);
    });
  });

  describe('computeDueAt', () => {
    it('returns null without a policy, so no policy means no deadline', () => {
      expect(computeDueAt(SUNDAY(10), null)).toBeNull();
      expect(computeDueAt(SUNDAY(10), undefined)).toBeNull();
    });

    it('adds wall-clock hours for a round-the-clock policy', () => {
      const due = computeDueAt(SUNDAY(10), {
        ...ROUND_THE_CLOCK,
        totalHours: 6,
      });
      expect(due).toEqual(SUNDAY(16));
    });

    it('adds working hours for a business-hours policy', () => {
      // 24 working hours = three 8-hour days: Sun, Mon, Tue.
      const due = computeDueAt(SUNDAY(9), EGYPT_POLICY);
      expect(due).toEqual(TUESDAY(17));
    });

    it('gives a Thursday case more wall-clock time than a Sunday case', () => {
      // The same budget, but one of them has a weekend in the middle. This is
      // the whole point of business hours, expressed as an inequality so it
      // cannot pass by accident.
      const fromSunday = computeDueAt(SUNDAY(10), EGYPT_POLICY)!;
      const fromThursday = computeDueAt(THURSDAY(10), EGYPT_POLICY)!;
      const sundaySpan = fromSunday.getTime() - SUNDAY(10).getTime();
      const thursdaySpan = fromThursday.getTime() - THURSDAY(10).getTime();
      expect(thursdaySpan).toBeGreaterThan(sundaySpan);
    });
  });

  describe('computeTat', () => {
    const base = {
      createdAt: SUNDAY(9),
      status: InvestigationStatus.SUBMITTED,
    };

    it('reports null for every stage that has not happened yet', () => {
      const tat = computeTat({ ...base, status: InvestigationStatus.NEW });
      expect(tat.assignmentMinutes).toBeNull();
      expect(tat.acceptanceMinutes).toBeNull();
      expect(tat.investigationMinutes).toBeNull();
      expect(tat.qcMinutes).toBeNull();
      expect(tat.isComplete).toBe(false);
    });

    it('never reports a stage as zero just because it is unfinished', () => {
      // This is the reason every field is nullable. A zero would be averaged
      // in as "instant", and a dashboard would report an assignment time that
      // falls as the backlog grows.
      const tat = computeTat({ ...base, assignedAt: SUNDAY(11) });
      expect(tat.assignmentMinutes).toBe(120);
      expect(tat.acceptanceMinutes).toBeNull();
      expect(tat.investigationMinutes).toBeNull();
    });

    it('measures each leg between its own pair of stamps', () => {
      const tat = computeTat(
        {
          ...base,
          assignedAt: SUNDAY(10),
          acceptedAt: SUNDAY(11),
          submittedAt: SUNDAY(15),
          qcAt: SUNDAY(16),
          completedAt: SUNDAY(16),
          status: InvestigationStatus.COMPLETED,
        },
        EGYPT_POLICY,
      );
      expect(tat.assignmentMinutes).toBe(60);
      expect(tat.acceptanceMinutes).toBe(60);
      expect(tat.investigationMinutes).toBe(240);
      expect(tat.qcMinutes).toBe(60);
      expect(tat.totalMinutes).toBe(420);
      expect(tat.isComplete).toBe(true);
    });

    it('discounts the weekend from the field leg under a business policy', () => {
      const timeline = {
        createdAt: THURSDAY(9),
        assignedAt: THURSDAY(10),
        acceptedAt: THURSDAY(11),
        submittedAt: NEXT_SUNDAY(11),
        status: InvestigationStatus.SUBMITTED,
      };
      // Thursday 11:00 → Sunday 11:00 is 72 wall-clock hours but 8 working
      // ones: six left on Thursday, two on Sunday morning.
      expect(computeTat(timeline, EGYPT_POLICY).investigationMinutes).toBe(480);
      expect(computeTat(timeline, ROUND_THE_CLOCK).investigationMinutes).toBe(
        72 * 60,
      );
    });

    it('measures a live case up to now, and a finished one up to completion', () => {
      const now = TUESDAY(12);
      const live = computeTat(
        { createdAt: SUNDAY(9), status: InvestigationStatus.IN_PROGRESS },
        ROUND_THE_CLOCK,
        now,
      );
      const done = computeTat(
        {
          createdAt: SUNDAY(9),
          completedAt: MONDAY(9),
          status: InvestigationStatus.COMPLETED,
        },
        ROUND_THE_CLOCK,
        now,
      );
      expect(live.totalMinutes).toBe(51 * 60);
      expect(live.isComplete).toBe(false);
      // The finished case stops at completion; `now` moving on does not
      // inflate a closed case's turnaround.
      expect(done.totalMinutes).toBe(24 * 60);
      expect(done.isComplete).toBe(true);
    });
  });

  describe('assessSla', () => {
    const live = (
      overrides: Partial<Parameters<typeof assessSla>[0]> = {},
    ): Parameters<typeof assessSla>[0] => ({
      createdAt: SUNDAY(9),
      status: InvestigationStatus.IN_PROGRESS,
      ...overrides,
    });

    it('is NOT_APPLICABLE with no policy — an absent SLA is not a met one', () => {
      const result = assessSla(live(), null, SUNDAY(12));
      expect(result.state).toBe(SlaState.NOT_APPLICABLE);
      expect(result.breached).toBe(false);
      expect(result.dueAt).toBeNull();
      expect(result.percentConsumed).toBeNull();
    });

    it('is GREEN early in the budget', () => {
      // 6 of 24 wall-clock hours = 25%.
      const result = assessSla(live(), ROUND_THE_CLOCK, SUNDAY(15));
      expect(result.state).toBe(SlaState.GREEN);
      expect(result.percentConsumed).toBe(25);
      expect(result.breached).toBe(false);
      expect(result.minutesRemaining).toBe(18 * 60);
    });

    it('turns YELLOW at the policy threshold, not one minute later', () => {
      // warnAtPercent is 80. At exactly 80% the badge must already warn —
      // an off-by-one here means the warning never fires for a case that
      // breaches at 81%.
      const at80 = new Date(SUNDAY(9).getTime() + 0.8 * 24 * 60 * 60_000);
      const result = assessSla(live(), ROUND_THE_CLOCK, at80);
      expect(result.percentConsumed).toBe(80);
      expect(result.state).toBe(SlaState.YELLOW);
      expect(result.breached).toBe(false);
    });

    it('honours a policy that wants to warn earlier', () => {
      const jumpy = { ...ROUND_THE_CLOCK, warnAtPercent: 50 };
      expect(assessSla(live(), jumpy, SUNDAY(21)).state).toBe(SlaState.YELLOW);
    });

    it('falls back to 80% when the policy has no threshold', () => {
      const unset = { ...ROUND_THE_CLOCK, warnAtPercent: 0 };
      const at50 = assessSla(live(), unset, SUNDAY(21));
      expect(at50.state).toBe(SlaState.GREEN);
    });

    it('turns RED and reports breached once the deadline passes', () => {
      const result = assessSla(live(), ROUND_THE_CLOCK, MONDAY(12));
      expect(result.state).toBe(SlaState.RED);
      expect(result.breached).toBe(true);
      expect(result.minutesRemaining).toBeLessThan(0);
    });

    it('settles a completed case to MET or BREACHED, never to a live colour', () => {
      // A finished case must stop asking for attention. RED means "act now";
      // a case closed last month cannot be acted on.
      const onTime = assessSla(
        live({
          completedAt: SUNDAY(20),
          status: InvestigationStatus.COMPLETED,
        }),
        ROUND_THE_CLOCK,
        NEXT_SUNDAY(9),
      );
      expect(onTime.state).toBe(SlaState.MET);
      expect(onTime.breached).toBe(false);

      const late = assessSla(
        live({
          completedAt: TUESDAY(9),
          status: InvestigationStatus.COMPLETED,
        }),
        ROUND_THE_CLOCK,
        NEXT_SUNDAY(9),
      );
      expect(late.state).toBe(SlaState.BREACHED);
      expect(late.breached).toBe(true);
    });

    it('keeps a breached case BREACHED however long ago it closed', () => {
      const justAfter = assessSla(
        live({
          completedAt: TUESDAY(9),
          status: InvestigationStatus.COMPLETED,
        }),
        ROUND_THE_CLOCK,
        TUESDAY(10),
      );
      const muchLater = assessSla(
        live({
          completedAt: TUESDAY(9),
          status: InvestigationStatus.COMPLETED,
        }),
        ROUND_THE_CLOCK,
        new Date(2027, 0, 1),
      );
      expect(justAfter.state).toBe(SlaState.BREACHED);
      expect(muchLater.state).toBe(SlaState.BREACHED);
    });

    it('drops the obligation for a cancelled case', () => {
      // A cancelled case has no deadline to miss. Leaving it RED would keep it
      // on a breach report forever and make the number meaningless.
      const result = assessSla(
        live({ status: InvestigationStatus.CANCELLED }),
        ROUND_THE_CLOCK,
        NEXT_SUNDAY(9),
      );
      expect(result.state).toBe(SlaState.NOT_APPLICABLE);
      expect(result.breached).toBe(false);
    });

    it('prefers a dueAt already stored on the case over a recomputed one', () => {
      // A policy can be edited after a case is raised. The deadline the case
      // was actually given is the one it is judged against.
      const pinned = MONDAY(9);
      const result = assessSla(
        live({ dueAt: pinned }),
        { ...ROUND_THE_CLOCK, totalHours: 1 },
        SUNDAY(12),
      );
      expect(result.dueAt).toEqual(pinned);
      expect(result.state).not.toBe(SlaState.RED);
    });

    it('does not go GREEN across a weekend under a business-hours policy', () => {
      // Thursday 15:00, an 8-working-hour SLA. By Saturday no working time has
      // passed at all, so the case is early — not breached.
      const eightWorkingHours = { ...EGYPT_POLICY, totalHours: 8 };
      const timeline = {
        createdAt: THURSDAY(15),
        status: InvestigationStatus.IN_PROGRESS,
      };
      const onSaturday = assessSla(timeline, eightWorkingHours, SATURDAY(12));
      expect(onSaturday.breached).toBe(false);
      expect(onSaturday.state).toBe(SlaState.GREEN);

      // The same elapsed wall-clock time under a 24/7 policy is a breach.
      const roundClock = { ...ROUND_THE_CLOCK, totalHours: 8 };
      expect(assessSla(timeline, roundClock, SATURDAY(12)).breached).toBe(true);
    });
  });

  describe('formatDuration', () => {
    it('passes null through rather than printing a zero', () => {
      expect(formatDuration(null)).toBeNull();
    });

    it.each([
      [0, '0m'],
      [45, '45m'],
      [59, '59m'],
      [60, '1h'],
      [90, '1h 30m'],
      [23 * 60, '23h'],
      [24 * 60, '1d'],
      [(24 + 4) * 60, '1d 4h'],
      [(48 + 12) * 60 + 30, '2d 12h'],
    ])('renders %i minutes as %s', (minutes, expected) => {
      expect(formatDuration(minutes)).toBe(expected);
    });
  });
});
