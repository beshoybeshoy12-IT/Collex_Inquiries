import { BadRequestException } from '@nestjs/common';
import { InvestigationStatus, PrincipalType } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The case lifecycle, as a machine rather than a column.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `Investigation.status` is never assigned from a request body. Every change
 *  goes through `assertTransition` here, which answers three questions:
 *
 *    - is this transition legal at all?
 *    - is this kind of principal allowed to make it?
 *    - which timestamp does it stamp?
 *
 *  Why a table and not a switch statement scattered across services: the
 *  interesting bugs in a workflow like this are the transitions nobody thought
 *  about — a submitted case being reassigned, a completed case going back to
 *  rework, an investigator marking a case ON_SITE for a case that was
 *  reassigned away from them ten minutes ago. Written as data, the whole space
 *  is visible on one screen and testable exhaustively. Written as `if`
 *  statements, it is visible nowhere.
 *
 *  WHO MAY DRIVE WHAT
 *
 *  The field transitions (ACCEPTED → EN_ROUTE → ON_SITE → IN_PROGRESS →
 *  SUBMITTED) belong to the investigator, because only the person standing
 *  outside the building knows they have arrived. The office transitions
 *  (assignment, QC, cancellation, archiving) belong to web users. A few are
 *  shared, and one — AUTO_VALIDATION → QC_PENDING — belongs to the system and
 *  no human at all.
 */

export type TransitionActor = PrincipalType | 'SYSTEM';

export interface TransitionRule {
  from: InvestigationStatus;
  to: InvestigationStatus;
  /** Who may drive it. Empty is never valid — a rule nobody can fire is dead. */
  actors: TransitionActor[];
  /** The column stamped when this transition happens. */
  stamps?: keyof CaseTimestamps;
  /** Requires a free-text reason, recorded on the history row. */
  requiresReason?: boolean;
  description: string;
}

export interface CaseTimestamps {
  assignedAt: Date;
  acceptedAt: Date;
  startedAt: Date;
  onSiteAt: Date;
  submittedAt: Date;
  qcAt: Date;
  completedAt: Date;
  cancelledAt: Date;
  archivedAt: Date;
}

const S = InvestigationStatus;
const WEB = PrincipalType.WEB_USER;
const FIELD = PrincipalType.INVESTIGATOR;
const SYSTEM: TransitionActor = 'SYSTEM';

/**
 * The complete transition table. Anything not listed here is illegal — that is
 * the point, and it is why the list is long and boring rather than clever.
 */
export const TRANSITIONS: TransitionRule[] = [
  // ── Intake ───────────────────────────────────────────────────────────────
  {
    from: S.NEW,
    to: S.VALIDATING,
    actors: [WEB, SYSTEM],
    description: 'Coordinator picks the case up for review.',
  },
  {
    from: S.NEW,
    to: S.READY_FOR_ASSIGNMENT,
    actors: [WEB, SYSTEM],
    description: 'Case passed intake checks and is queued for assignment.',
  },
  {
    from: S.VALIDATING,
    to: S.READY_FOR_ASSIGNMENT,
    actors: [WEB, SYSTEM],
    description: 'Coordinator finished checking the case data.',
  },
  {
    from: S.VALIDATING,
    to: S.NEW,
    actors: [WEB],
    description: 'Coordinator put the case back in the intake queue.',
  },

  // ── Assignment ───────────────────────────────────────────────────────────
  {
    from: S.READY_FOR_ASSIGNMENT,
    to: S.ASSIGNED,
    actors: [WEB, SYSTEM],
    stamps: 'assignedAt',
    description: 'Assigned to a field investigator.',
  },
  {
    // A case can be pulled back before the investigator accepts it.
    from: S.ASSIGNED,
    to: S.READY_FOR_ASSIGNMENT,
    actors: [WEB, SYSTEM],
    requiresReason: true,
    description: 'Assignment withdrawn; back to the unassigned queue.',
  },
  {
    from: S.ASSIGNED,
    to: S.ASSIGNED,
    actors: [WEB],
    stamps: 'assignedAt',
    requiresReason: true,
    description: 'Reassigned to a different investigator.',
  },
  {
    from: S.ASSIGNED,
    to: S.ACCEPTED,
    actors: [FIELD],
    stamps: 'acceptedAt',
    description: 'Investigator accepted the assignment.',
  },
  {
    from: S.ASSIGNED,
    to: S.READY_FOR_ASSIGNMENT,
    actors: [FIELD],
    requiresReason: true,
    description: 'Investigator declined; the case returns to the queue.',
  },

  // ── Field work ───────────────────────────────────────────────────────────
  {
    from: S.ACCEPTED,
    to: S.EN_ROUTE,
    actors: [FIELD],
    stamps: 'startedAt',
    description: 'Investigator is travelling to the address.',
  },
  {
    from: S.ACCEPTED,
    to: S.ON_SITE,
    actors: [FIELD],
    stamps: 'onSiteAt',
    description: 'Investigator arrived (already nearby; no travel leg).',
  },
  {
    from: S.EN_ROUTE,
    to: S.ON_SITE,
    actors: [FIELD],
    stamps: 'onSiteAt',
    description: 'Investigator checked in at the address.',
  },
  {
    from: S.ON_SITE,
    to: S.IN_PROGRESS,
    actors: [FIELD],
    description: 'Investigator is filling in the form.',
  },
  {
    // The visit can be abandoned and retried — nobody home, wrong address.
    from: S.ON_SITE,
    to: S.ACCEPTED,
    actors: [FIELD],
    requiresReason: true,
    description: 'Visit abandoned; investigator will return.',
  },
  {
    from: S.IN_PROGRESS,
    to: S.SUBMITTED,
    actors: [FIELD],
    stamps: 'submittedAt',
    description: 'Investigator submitted the completed form.',
  },
  {
    from: S.IN_PROGRESS,
    to: S.ACCEPTED,
    actors: [FIELD],
    requiresReason: true,
    description: 'Work paused; investigator will resume later.',
  },

  // ── Automatic checks, then QC ────────────────────────────────────────────
  {
    from: S.SUBMITTED,
    to: S.AUTO_VALIDATION,
    actors: [SYSTEM],
    description: 'Queued for the automatic completeness check.',
  },
  {
    from: S.AUTO_VALIDATION,
    to: S.QC_PENDING,
    actors: [SYSTEM],
    description: 'Automatic checks passed; waiting for a QC officer.',
  },
  {
    from: S.AUTO_VALIDATION,
    to: S.REWORK,
    actors: [SYSTEM],
    requiresReason: true,
    description: 'Automatic checks failed; sent straight back to the field.',
  },
  {
    // If the queue is unavailable the case must not be stuck: a coordinator
    // can push it into QC by hand.
    from: S.SUBMITTED,
    to: S.QC_PENDING,
    actors: [WEB],
    description: 'Sent to QC without waiting for the automatic check.',
  },

  {
    from: S.QC_PENDING,
    to: S.QC_APPROVED,
    actors: [WEB],
    stamps: 'qcAt',
    description: 'QC accepted the work.',
  },
  {
    from: S.QC_PENDING,
    to: S.QC_REJECTED,
    actors: [WEB],
    stamps: 'qcAt',
    requiresReason: true,
    description: 'QC rejected the work outright.',
  },
  {
    from: S.QC_PENDING,
    to: S.REWORK,
    actors: [WEB],
    stamps: 'qcAt',
    requiresReason: true,
    description: 'QC asked for corrections.',
  },

  // ── Rework ───────────────────────────────────────────────────────────────
  {
    from: S.QC_REJECTED,
    to: S.REWORK,
    actors: [WEB],
    requiresReason: true,
    description: 'Rejected case reopened for correction.',
  },
  {
    from: S.REWORK,
    to: S.ASSIGNED,
    actors: [WEB],
    stamps: 'assignedAt',
    description: 'Rework assigned — to the same investigator or another.',
  },
  {
    from: S.REWORK,
    to: S.ACCEPTED,
    actors: [FIELD],
    description: 'Investigator picked the rework back up.',
  },
  {
    from: S.REWORK,
    to: S.IN_PROGRESS,
    actors: [FIELD],
    description: 'Investigator started correcting the submission.',
  },

  // ── Completion ───────────────────────────────────────────────────────────
  {
    from: S.QC_APPROVED,
    to: S.REPORT_GENERATION,
    actors: [WEB, SYSTEM],
    description: 'Final report queued for generation.',
  },
  {
    from: S.REPORT_GENERATION,
    to: S.COMPLETED,
    actors: [SYSTEM, WEB],
    stamps: 'completedAt',
    description: 'Report generated; the case is finished.',
  },
  {
    from: S.REPORT_GENERATION,
    to: S.QC_APPROVED,
    actors: [SYSTEM],
    requiresReason: true,
    description: 'Report generation failed; back to approved for a retry.',
  },
  {
    // Some tenants deliver without a generated PDF.
    from: S.QC_APPROVED,
    to: S.COMPLETED,
    actors: [WEB],
    stamps: 'completedAt',
    description: 'Closed without generating a report.',
  },
  {
    from: S.COMPLETED,
    to: S.ARCHIVED,
    actors: [WEB, SYSTEM],
    stamps: 'archivedAt',
    description: 'Moved to the archive.',
  },
  {
    from: S.CANCELLED,
    to: S.ARCHIVED,
    actors: [WEB, SYSTEM],
    stamps: 'archivedAt',
    description: 'Cancelled case archived.',
  },
];

/**
 * Cancellation is legal from anywhere that is not already terminal, so it is
 * expanded rather than written out thirteen times — and expanding it from a
 * list of terminal states means a new status is automatically cancellable
 * unless somebody deliberately adds it here.
 */
export const TERMINAL_STATUSES: InvestigationStatus[] = [
  S.COMPLETED,
  S.CANCELLED,
  S.ARCHIVED,
];

const CANCELLABLE = Object.values(S).filter(
  (status) => !TERMINAL_STATUSES.includes(status),
);

const ALL_TRANSITIONS: TransitionRule[] = [
  ...TRANSITIONS,
  ...CANCELLABLE.map((from): TransitionRule => ({
    from,
    to: S.CANCELLED,
    actors: [WEB],
    stamps: 'cancelledAt',
    requiresReason: true,
    description: 'Case cancelled.',
  })),
];

/** Indexed for lookup — `from → to → rule`. */
const INDEX = new Map<string, TransitionRule>(
  ALL_TRANSITIONS.map((rule) => [`${rule.from}->${rule.to}`, rule]),
);

export function findTransition(
  from: InvestigationStatus,
  to: InvestigationStatus,
): TransitionRule | undefined {
  return INDEX.get(`${from}->${to}`);
}

/** Every status reachable from `from` by `actor`. Drives the UI's action bar. */
export function allowedNextStatuses(
  from: InvestigationStatus,
  actor: TransitionActor,
): InvestigationStatus[] {
  return ALL_TRANSITIONS.filter(
    (rule) => rule.from === from && rule.actors.includes(actor),
  ).map((rule) => rule.to);
}

export class IllegalTransitionError extends BadRequestException {
  constructor(
    public readonly from: InvestigationStatus,
    public readonly to: InvestigationStatus,
    reason: string,
  ) {
    super({
      message: reason,
      errorCode: 'ILLEGAL_STATUS_TRANSITION',
      from,
      to,
    });
  }
}

/**
 * The gate every status change passes through.
 *
 * Returns the rule so the caller can apply its timestamp, rather than the
 * caller carrying its own idea of which column to set — which is how the stamp
 * and the status drift apart.
 */
export function assertTransition(
  from: InvestigationStatus,
  to: InvestigationStatus,
  actor: TransitionActor,
  reason?: string,
): TransitionRule {
  const rule = findTransition(from, to);

  if (!rule) {
    throw new IllegalTransitionError(
      from,
      to,
      `لا يمكن نقل الحالة من ${from} إلى ${to} - ` +
        `Cannot move a case from ${from} to ${to}`,
    );
  }

  if (!rule.actors.includes(actor)) {
    throw new IllegalTransitionError(
      from,
      to,
      `هذا الإجراء غير متاح لهذا النوع من المستخدمين - ` +
        `A ${actor === 'SYSTEM' ? 'system' : actor.toLowerCase().replace('_', ' ')} ` +
        `cannot move a case from ${from} to ${to}`,
    );
  }

  if (rule.requiresReason && !reason?.trim()) {
    throw new IllegalTransitionError(
      from,
      to,
      'هذا الإجراء يتطلب ذكر السبب - This action requires a reason',
    );
  }

  return rule;
}

/**
 * The status buckets the case list and the dashboard count by.
 *
 * Defined once here so a case cannot be in "In Progress" on the dashboard and
 * "Submitted" in the sidebar because two screens each wrote their own list.
 */
export const STATUS_GROUPS = {
  NEW: [S.NEW, S.VALIDATING],
  UNASSIGNED: [S.READY_FOR_ASSIGNMENT],
  ASSIGNED: [S.ASSIGNED, S.ACCEPTED],
  IN_PROGRESS: [S.EN_ROUTE, S.ON_SITE, S.IN_PROGRESS],
  SUBMITTED: [S.SUBMITTED, S.AUTO_VALIDATION],
  QC: [S.QC_PENDING],
  REWORK: [S.QC_REJECTED, S.REWORK],
  COMPLETED: [S.QC_APPROVED, S.REPORT_GENERATION, S.COMPLETED],
  CLOSED: [S.CANCELLED, S.ARCHIVED],
} as const satisfies Record<string, readonly InvestigationStatus[]>;

export type StatusGroup = keyof typeof STATUS_GROUPS;

/**
 * Statuses that count as open work for the workload check on assignment.
 *
 * Deliberately excludes QC and beyond: a case waiting for a QC officer is not
 * occupying the investigator's day, and counting it would make a productive
 * investigator look full.
 */
export const OPEN_FOR_INVESTIGATOR: InvestigationStatus[] = [
  S.ASSIGNED,
  S.ACCEPTED,
  S.EN_ROUTE,
  S.ON_SITE,
  S.IN_PROGRESS,
  S.REWORK,
];
