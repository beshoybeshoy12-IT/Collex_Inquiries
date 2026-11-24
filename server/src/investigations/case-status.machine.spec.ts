import { InvestigationStatus, PrincipalType, SlaState } from '@prisma/client';
import {
  allowedNextStatuses,
  assertTransition,
  findTransition,
  IllegalTransitionError,
  overrideTransition,
  OPEN_FOR_INVESTIGATOR,
  STATUS_GROUPS,
  TERMINAL_STATUSES,
  TRANSITIONS,
} from './case-status.machine';
import {
  addBusinessHours,
  assessSla,
  businessMinutesBetween,
  computeDueAt,
  computeTat,
  formatDuration,
  SlaPolicyShape,
} from './sla.util';

const S = InvestigationStatus;
const WEB = PrincipalType.WEB_USER;
const FIELD = PrincipalType.INVESTIGATOR;

describe('case status machine', () => {
  describe('the happy path, end to end', () => {
    it('walks a case from intake to archive', () => {
      // The full journey the acceptance criteria describe, each step checked
      // against the actor who would really perform it.
      const journey: [InvestigationStatus, InvestigationStatus, any][] = [
        [S.NEW, S.VALIDATING, WEB],
        [S.VALIDATING, S.READY_FOR_ASSIGNMENT, WEB],
        [S.READY_FOR_ASSIGNMENT, S.ASSIGNED, WEB],
        [S.ASSIGNED, S.ACCEPTED, FIELD],
        [S.ACCEPTED, S.EN_ROUTE, FIELD],
        [S.EN_ROUTE, S.ON_SITE, FIELD],
        [S.ON_SITE, S.IN_PROGRESS, FIELD],
        [S.IN_PROGRESS, S.SUBMITTED, FIELD],
        [S.SUBMITTED, S.AUTO_VALIDATION, 'SYSTEM'],
        [S.AUTO_VALIDATION, S.QC_PENDING, 'SYSTEM'],
        [S.QC_PENDING, S.QC_APPROVED, WEB],
        [S.QC_APPROVED, S.REPORT_GENERATION, WEB],
        [S.REPORT_GENERATION, S.COMPLETED, 'SYSTEM'],
        [S.COMPLETED, S.ARCHIVED, WEB],
      ];

      for (const [from, to, actor] of journey) {
        expect(() => assertTransition(from, to, actor)).not.toThrow();
      }
    });

    it('walks the rework loop and back into QC', () => {
      expect(() =>
        assertTransition(
          S.QC_PENDING,
          S.REWORK,
          WEB,
          'missing residence photo',
        ),
      ).not.toThrow();
      expect(() => assertTransition(S.REWORK, S.ASSIGNED, WEB)).not.toThrow();
      expect(() =>
        assertTransition(S.ASSIGNED, S.ACCEPTED, FIELD),
      ).not.toThrow();
      expect(() =>
        assertTransition(S.ACCEPTED, S.ON_SITE, FIELD),
      ).not.toThrow();
      expect(() =>
        assertTransition(S.ON_SITE, S.IN_PROGRESS, FIELD),
      ).not.toThrow();
      expect(() =>
        assertTransition(S.IN_PROGRESS, S.SUBMITTED, FIELD),
      ).not.toThrow();
    });
  });

  describe('illegal transitions', () => {
    it('refuses to skip the field work entirely', () => {
      // The transition an over-eager "just mark it done" button would make.
      expect(() => assertTransition(S.NEW, S.COMPLETED, WEB)).toThrow(
        IllegalTransitionError,
      );
      expect(() =>
        assertTransition(S.READY_FOR_ASSIGNMENT, S.SUBMITTED, WEB),
      ).toThrow(IllegalTransitionError);
    });

    it('refuses to reopen a finished case', () => {
      for (const terminal of [S.COMPLETED, S.ARCHIVED, S.CANCELLED]) {
        expect(() => assertTransition(terminal, S.IN_PROGRESS, WEB)).toThrow(
          IllegalTransitionError,
        );
        expect(() => assertTransition(terminal, S.ASSIGNED, WEB)).toThrow(
          IllegalTransitionError,
        );
      }
    });

    it('refuses to cancel an already-terminal case', () => {
      for (const terminal of TERMINAL_STATUSES) {
        expect(() =>
          assertTransition(terminal, S.CANCELLED, WEB, 'client withdrew'),
        ).toThrow(IllegalTransitionError);
      }
    });
  });

  describe('who may drive what', () => {
    it('does not let an investigator approve their own work', () => {
      // The single most important rule in the QC model.
      expect(() =>
        assertTransition(S.QC_PENDING, S.QC_APPROVED, FIELD),
      ).toThrow(IllegalTransitionError);
      expect(() =>
        assertTransition(S.QC_PENDING, S.REWORK, FIELD, 'looks fine to me'),
      ).toThrow(IllegalTransitionError);
    });

    it('does not let a coordinator check in at an address', () => {
      // Only the person standing there knows they have arrived.
      expect(() => assertTransition(S.EN_ROUTE, S.ON_SITE, WEB)).toThrow(
        IllegalTransitionError,
      );
      expect(() => assertTransition(S.ACCEPTED, S.EN_ROUTE, WEB)).toThrow(
        IllegalTransitionError,
      );
      expect(() => assertTransition(S.IN_PROGRESS, S.SUBMITTED, WEB)).toThrow(
        IllegalTransitionError,
      );
    });

    it('lets the office hand in a paper form — through the form only', () => {
      // A paper visit never recorded ACCEPTED/ON_SITE/IN_PROGRESS in the app,
      // so the office may submit from wherever the field work stands. But
      // "submitted" must mean there are answers: from the status bar (no
      // viaForm) it stays refused, exactly as the test above requires.
      for (const from of [
        S.ASSIGNED,
        S.ACCEPTED,
        S.EN_ROUTE,
        S.ON_SITE,
        S.IN_PROGRESS,
        S.REWORK,
      ]) {
        expect(() => assertTransition(from, S.SUBMITTED, WEB)).toThrow(
          IllegalTransitionError,
        );
        expect(() =>
          assertTransition(from, S.SUBMITTED, WEB, undefined, {
            viaForm: true,
          }),
        ).not.toThrow();
      }
      // The investigator's own submit is unaffected.
      expect(() =>
        assertTransition(S.IN_PROGRESS, S.SUBMITTED, FIELD),
      ).not.toThrow();
    });

    it('never offers a form-only move on the status bar', () => {
      expect(allowedNextStatuses(S.IN_PROGRESS, WEB)).not.toContain(
        S.SUBMITTED,
      );
      expect(allowedNextStatuses(S.ASSIGNED, WEB)).not.toContain(S.SUBMITTED);
      expect(allowedNextStatuses(S.IN_PROGRESS, FIELD)).toContain(S.SUBMITTED);
    });

    it('does not let a human fire the system-only transitions', () => {
      expect(() =>
        assertTransition(S.SUBMITTED, S.AUTO_VALIDATION, WEB),
      ).toThrow(IllegalTransitionError);
      expect(() =>
        assertTransition(S.AUTO_VALIDATION, S.QC_PENDING, WEB),
      ).toThrow(IllegalTransitionError);
    });

    it('lets an investigator decline an assignment but not cancel the case', () => {
      expect(() =>
        assertTransition(
          S.ASSIGNED,
          S.READY_FOR_ASSIGNMENT,
          FIELD,
          'out of area',
        ),
      ).not.toThrow();
      expect(() =>
        assertTransition(S.ASSIGNED, S.CANCELLED, FIELD, 'do not want it'),
      ).toThrow(IllegalTransitionError);
    });
  });

  describe('reasons', () => {
    it('demands one where the rule says so', () => {
      expect(() => assertTransition(S.QC_PENDING, S.REWORK, WEB)).toThrow(
        /requires a reason/i,
      );
      expect(() => assertTransition(S.ASSIGNED, S.ASSIGNED, WEB)).toThrow(
        /requires a reason/i,
      );
      expect(() => assertTransition(S.IN_PROGRESS, S.CANCELLED, WEB)).toThrow(
        /requires a reason/i,
      );
    });

    it('rejects whitespace as a reason', () => {
      expect(() =>
        assertTransition(S.QC_PENDING, S.REWORK, WEB, '   '),
      ).toThrow(/requires a reason/i);
    });

    it('accepts a real reason', () => {
      expect(() =>
        assertTransition(S.QC_PENDING, S.REWORK, WEB, 'ID photo is unreadable'),
      ).not.toThrow();
    });
  });

  describe('timestamps', () => {
    it('stamps each milestone exactly once and on the right column', () => {
      expect(findTransition(S.READY_FOR_ASSIGNMENT, S.ASSIGNED)?.stamps).toBe(
        'assignedAt',
      );
      expect(findTransition(S.ASSIGNED, S.ACCEPTED)?.stamps).toBe('acceptedAt');
      expect(findTransition(S.EN_ROUTE, S.ON_SITE)?.stamps).toBe('onSiteAt');
      expect(findTransition(S.IN_PROGRESS, S.SUBMITTED)?.stamps).toBe(
        'submittedAt',
      );
      expect(findTransition(S.QC_PENDING, S.QC_APPROVED)?.stamps).toBe('qcAt');
      expect(findTransition(S.REPORT_GENERATION, S.COMPLETED)?.stamps).toBe(
        'completedAt',
      );
      expect(findTransition(S.COMPLETED, S.ARCHIVED)?.stamps).toBe(
        'archivedAt',
      );
    });
  });

  describe('cancellation', () => {
    it('is reachable from every non-terminal status', () => {
      const nonTerminal = Object.values(S).filter(
        (status) => !TERMINAL_STATUSES.includes(status),
      );
      for (const status of nonTerminal) {
        expect(() =>
          assertTransition(status, S.CANCELLED, WEB, 'client withdrew'),
        ).not.toThrow();
      }
    });
  });

  describe('allowedNextStatuses', () => {
    it('gives the investigator only their own moves', () => {
      const next = allowedNextStatuses(S.ASSIGNED, FIELD);
      expect(next).toContain(S.ACCEPTED);
      expect(next).toContain(S.READY_FOR_ASSIGNMENT);
      expect(next).not.toContain(S.CANCELLED);
      expect(next).not.toContain(S.QC_PENDING);
    });

    it('is empty at the end of the line', () => {
      expect(allowedNextStatuses(S.ARCHIVED, WEB)).toEqual([]);
      expect(allowedNextStatuses(S.ARCHIVED, FIELD)).toEqual([]);
    });
  });

  describe('table integrity', () => {
    it('has no rule that nobody can fire', () => {
      for (const rule of TRANSITIONS) {
        expect(rule.actors.length).toBeGreaterThan(0);
      }
    });

    it('accounts for every status in exactly one dashboard group', () => {
      // A status in two groups double-counts on the dashboard; a status in
      // none disappears from it. Both are silent.
      const seen = new Map<InvestigationStatus, number>();
      for (const group of Object.values(STATUS_GROUPS)) {
        for (const status of group) {
          seen.set(status, (seen.get(status) ?? 0) + 1);
        }
      }
      for (const status of Object.values(S)) {
        expect(seen.get(status)).toBe(1);
      }
    });

    it('counts only genuinely-open work against an investigator', () => {
      // A case sitting in QC is not occupying the investigator's day.
      expect(OPEN_FOR_INVESTIGATOR).not.toContain(S.QC_PENDING);
      expect(OPEN_FOR_INVESTIGATOR).not.toContain(S.SUBMITTED);
      expect(OPEN_FOR_INVESTIGATOR).not.toContain(S.COMPLETED);
      expect(OPEN_FOR_INVESTIGATOR).toContain(S.ASSIGNED);
      expect(OPEN_FOR_INVESTIGATOR).toContain(S.REWORK);
    });
  });
});

describe('SLA and TAT', () => {
  const roundClock: SlaPolicyShape = {
    totalHours: 48,
    assignmentHours: 4,
    acceptanceHours: 2,
    fieldHours: 24,
    qcHours: 12,
    warnAtPercent: 80,
    businessHoursOnly: false,
    workdayStartHour: 9,
    workdayEndHour: 17,
    workdays: [7, 1, 2, 3, 4],
  };

  // Sunday to Thursday, 09:00–17:00 — the Egyptian working week.
  const businessHours: SlaPolicyShape = {
    ...roundClock,
    totalHours: 16,
    businessHoursOnly: true,
  };

  describe('wall-clock policies', () => {
    it('is GREEN early and YELLOW past the warning threshold', () => {
      const createdAt = new Date('2026-03-01T00:00:00Z');

      const early = assessSla(
        { createdAt, status: S.ASSIGNED },
        roundClock,
        new Date('2026-03-01T06:00:00Z'),
      );
      expect(early.state).toBe(SlaState.GREEN);
      expect(early.percentConsumed).toBe(13);

      const late = assessSla(
        { createdAt, status: S.ASSIGNED },
        roundClock,
        new Date('2026-03-02T16:00:00Z'), // 40 of 48 hours = 83%
      );
      expect(late.state).toBe(SlaState.YELLOW);
      expect(late.breached).toBe(false);
    });

    it('turns RED once the deadline passes', () => {
      const assessment = assessSla(
        { createdAt: new Date('2026-03-01T00:00:00Z'), status: S.IN_PROGRESS },
        roundClock,
        new Date('2026-03-03T06:00:00Z'),
      );
      expect(assessment.state).toBe(SlaState.RED);
      expect(assessment.breached).toBe(true);
      expect(assessment.minutesRemaining).toBeLessThan(0);
    });

    it('settles to MET or BREACHED once the case completes', () => {
      const createdAt = new Date('2026-03-01T00:00:00Z');

      const met = assessSla(
        {
          createdAt,
          completedAt: new Date('2026-03-02T00:00:00Z'),
          status: S.COMPLETED,
        },
        roundClock,
      );
      expect(met.state).toBe(SlaState.MET);

      const missed = assessSla(
        {
          createdAt,
          completedAt: new Date('2026-03-04T00:00:00Z'),
          status: S.COMPLETED,
        },
        roundClock,
      );
      expect(missed.state).toBe(SlaState.BREACHED);
      expect(missed.breached).toBe(true);
    });

    it('reports a finished case as settled rather than live', () => {
      // A completed-but-late case must not read RED, which means "act now".
      const missed = assessSla(
        {
          createdAt: new Date('2026-03-01T00:00:00Z'),
          completedAt: new Date('2026-03-09T00:00:00Z'),
          status: S.COMPLETED,
        },
        roundClock,
        new Date('2026-04-01T00:00:00Z'),
      );
      expect(missed.state).toBe(SlaState.BREACHED);
      expect(missed.state).not.toBe(SlaState.RED);
    });

    it('says NOT_APPLICABLE when there is no policy at all', () => {
      const none = assessSla({ createdAt: new Date(), status: S.NEW }, null);
      expect(none.state).toBe(SlaState.NOT_APPLICABLE);
      expect(none.dueAt).toBeNull();
    });

    it('says NOT_APPLICABLE for a cancelled case', () => {
      const cancelled = assessSla(
        { createdAt: new Date('2026-03-01T00:00:00Z'), status: S.CANCELLED },
        roundClock,
        new Date('2026-03-20T00:00:00Z'),
      );
      expect(cancelled.state).toBe(SlaState.NOT_APPLICABLE);
      expect(cancelled.breached).toBe(false);
    });
  });

  describe('business-hours policies', () => {
    it('does not count the weekend against the investigator', () => {
      // Thursday 16:00 local. Friday and Saturday are not workdays, so only
      // one working hour has passed by Sunday 10:00.
      const thursdayAfternoon = new Date(2026, 2, 5, 16, 0, 0); // Thu 5 Mar
      const sundayMorning = new Date(2026, 2, 8, 10, 0, 0); // Sun 8 Mar

      const wallClock = businessMinutesBetween(
        thursdayAfternoon,
        sundayMorning,
        { workdayStartHour: 9, workdayEndHour: 17, workdays: [7, 1, 2, 3, 4] },
      );

      // Thursday 16:00→17:00 = 60, then Sunday 09:00→10:00 = 60.
      expect(wallClock).toBe(120);
    });

    it('pushes a deadline past the weekend', () => {
      const thursdayAfternoon = new Date(2026, 2, 5, 16, 0, 0);
      const due = addBusinessHours(thursdayAfternoon, 8, businessHours);

      // One hour on Thursday, then seven on Sunday → Sunday 16:00.
      expect(due.getDay()).toBe(0); // Sunday
      expect(due.getHours()).toBe(16);
    });

    it('does not breach a case over a weekend it was never meant to be worked', () => {
      const thursdayAfternoon = new Date(2026, 2, 5, 16, 0, 0);
      const dueAt = computeDueAt(thursdayAfternoon, businessHours);

      const saturday = new Date(2026, 2, 7, 12, 0, 0);
      const assessment = assessSla(
        { createdAt: thursdayAfternoon, dueAt, status: S.ASSIGNED },
        businessHours,
        saturday,
      );

      expect(assessment.breached).toBe(false);
      expect(assessment.state).not.toBe(SlaState.RED);
    });
  });

  describe('TAT breakdown', () => {
    it('splits the journey into its stages', () => {
      const tat = computeTat(
        {
          createdAt: new Date('2026-03-01T08:00:00Z'),
          assignedAt: new Date('2026-03-01T09:00:00Z'),
          acceptedAt: new Date('2026-03-01T09:30:00Z'),
          submittedAt: new Date('2026-03-01T14:30:00Z'),
          qcAt: new Date('2026-03-01T16:00:00Z'),
          completedAt: new Date('2026-03-01T16:30:00Z'),
          status: S.COMPLETED,
        },
        roundClock,
      );

      expect(tat.assignmentMinutes).toBe(60);
      expect(tat.acceptanceMinutes).toBe(30);
      expect(tat.investigationMinutes).toBe(300);
      expect(tat.qcMinutes).toBe(90);
      expect(tat.totalMinutes).toBe(510);
      expect(tat.isComplete).toBe(true);
    });

    it('leaves stages that have not happened as null rather than zero', () => {
      // A zero here would drag every average down and look like excellent
      // performance rather than missing data.
      const tat = computeTat(
        {
          createdAt: new Date('2026-03-01T08:00:00Z'),
          assignedAt: new Date('2026-03-01T09:00:00Z'),
          status: S.ASSIGNED,
        },
        roundClock,
        new Date('2026-03-01T10:00:00Z'),
      );

      expect(tat.assignmentMinutes).toBe(60);
      expect(tat.acceptanceMinutes).toBeNull();
      expect(tat.investigationMinutes).toBeNull();
      expect(tat.qcMinutes).toBeNull();
      expect(tat.isComplete).toBe(false);
    });
  });

  describe('formatDuration', () => {
    it.each([
      [null, null],
      [0, '0m'],
      [45, '45m'],
      [60, '1h'],
      [90, '1h 30m'],
      [1440, '1d'],
      [1500, '1d 1h'],
    ])('formats %p as %p', (minutes, expected) => {
      expect(formatDuration(minutes)).toBe(expected);
    });
  });
});

describe('overrideTransition — the exceptional move', () => {
  const S = InvestigationStatus;

  it('may skip steps the machine would require', () => {
    // NEW straight to COMPLETED is illegal normally; an override allows it.
    const rule = overrideTransition(S.NEW, S.COMPLETED, {
      hasInvestigator: true,
      reason: 'Closed by phone with the bank',
    });
    expect(rule.to).toBe(S.COMPLETED);
  });

  it('stamps what the normal route into that status stamps', () => {
    const rule = overrideTransition(S.READY_FOR_ASSIGNMENT, S.ACCEPTED, {
      hasInvestigator: true,
      reason: 'Accepted by phone',
    });
    expect(rule.stamps).toBe('acceptedAt');
  });

  it('refuses without a real reason', () => {
    expect(() =>
      overrideTransition(S.NEW, S.CANCELLED, {
        hasInvestigator: false,
        reason: ' ok ',
      }),
    ).toThrow(IllegalTransitionError);
  });

  it('refuses a field status with nobody to do the visit', () => {
    expect(() =>
      overrideTransition(S.READY_FOR_ASSIGNMENT, S.IN_PROGRESS, {
        hasInvestigator: false,
        reason: 'Moving it along',
      }),
    ).toThrow(IllegalTransitionError);
  });

  it('refuses a move to the status it is already in', () => {
    expect(() =>
      overrideTransition(S.QC_PENDING, S.QC_PENDING, {
        hasInvestigator: true,
        reason: 'No change at all',
      }),
    ).toThrow(IllegalTransitionError);
  });
});
