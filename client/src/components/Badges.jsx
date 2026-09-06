import { useTranslation } from 'react-i18next';

/**
 * Status, SLA and priority badges.
 *
 * The colour maps live here and nowhere else. A status that is amber on the
 * case list and grey on the dashboard reads as two different things, and the
 * only way to prevent that is for both screens to render the same component.
 *
 * Every badge carries its own text, not only a colour: a colour-only status is
 * unreadable to a colour-blind user and invisible in a printed report.
 */

const STATUS_TONE = {
  NEW: 'secondary',
  VALIDATING: 'secondary',
  READY_FOR_ASSIGNMENT: 'info',
  ASSIGNED: 'primary',
  ACCEPTED: 'primary',
  EN_ROUTE: 'primary',
  ON_SITE: 'primary',
  IN_PROGRESS: 'primary',
  SUBMITTED: 'warning',
  AUTO_VALIDATION: 'warning',
  QC_PENDING: 'warning',
  QC_APPROVED: 'success',
  QC_REJECTED: 'danger',
  REWORK: 'danger',
  REPORT_GENERATION: 'info',
  COMPLETED: 'success',
  CANCELLED: 'dark',
  ARCHIVED: 'dark',
};

export function StatusBadge({ status, className = '' }) {
  const { t } = useTranslation();
  if (!status) return null;

  const tone = STATUS_TONE[status] ?? 'secondary';
  return (
    <span className={`badge text-bg-${tone} ${className}`}>
      {t(`status.${status}`, status)}
    </span>
  );
}

const SLA_TONE = {
  GREEN: 'success',
  YELLOW: 'warning',
  RED: 'danger',
  MET: 'success',
  BREACHED: 'danger',
  NOT_APPLICABLE: 'secondary',
};

/**
 * The SLA badge shows the remaining time as well as the state, because "at
 * risk" without a number is not something a coordinator can prioritise on.
 */
export function SlaBadge({ sla, className = '' }) {
  const { t } = useTranslation();
  if (!sla || sla.state === 'NOT_APPLICABLE') return null;

  const tone = SLA_TONE[sla.state] ?? 'secondary';
  const minutes = sla.minutesRemaining;

  let suffix = '';
  if (typeof minutes === 'number' && ['GREEN', 'YELLOW', 'RED'].includes(sla.state)) {
    const absolute = Math.abs(minutes);
    const readable =
      absolute >= 1440
        ? `${Math.floor(absolute / 1440)}d`
        : absolute >= 60
          ? `${Math.floor(absolute / 60)}h`
          : `${absolute}m`;
    suffix = minutes < 0 ? ` +${readable}` : ` ${readable}`;
  }

  return (
    <span
      className={`badge text-bg-${tone} ${className}`}
      title={
        sla.dueAt ? new Date(sla.dueAt).toLocaleString() : undefined
      }
    >
      {t(`slaState.${sla.state}`, sla.state)}
      {suffix}
    </span>
  );
}

const PRIORITY_TONE = {
  LOW: 'secondary',
  NORMAL: 'secondary',
  HIGH: 'warning',
  URGENT: 'danger',
};

export function PriorityBadge({ priority, className = '' }) {
  const { t } = useTranslation();
  if (!priority) return null;

  // Normal is the overwhelming majority; badging it adds noise to every row
  // without telling anybody anything.
  if (priority === 'NORMAL') {
    return (
      <span className={`text-body-secondary small ${className}`}>
        {t('priority.NORMAL')}
      </span>
    );
  }

  return (
    <span className={`badge text-bg-${PRIORITY_TONE[priority] ?? 'secondary'} ${className}`}>
      {t(`priority.${priority}`, priority)}
    </span>
  );
}

const AVAILABILITY_TONE = {
  OFFLINE: 'secondary',
  ONLINE: 'info',
  AVAILABLE: 'success',
  BUSY: 'warning',
  ON_VISIT: 'primary',
  EN_ROUTE: 'primary',
  ON_LEAVE: 'dark',
};

export function AvailabilityBadge({ availability, className = '' }) {
  const { t } = useTranslation();
  if (!availability) return null;

  return (
    <span
      className={`badge text-bg-${AVAILABILITY_TONE[availability] ?? 'secondary'} ${className}`}
    >
      {t(`availability.${availability}`, availability)}
    </span>
  );
}

const GENERIC_TONE = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  DISABLED: 'secondary',
  SUSPENDED: 'danger',
  IN_TRAINING: 'info',
  PENDING: 'warning',
  LOCKED: 'danger',
  READY: 'success',
  QUEUED: 'secondary',
  GENERATING: 'info',
  FAILED: 'danger',
  COMPLETED: 'success',
  COMPLETED_WITH_ERRORS: 'warning',
  CANCELLED: 'dark',
  PREVIEW_READY: 'info',
  PROCESSING: 'info',
  UPLOADED: 'secondary',
  PARSING: 'info',
  CONFIRMED: 'primary',
  VALID: 'success',
  INVALID: 'danger',
  DUPLICATE: 'warning',
  IMPORTED: 'success',
  SKIPPED: 'secondary',
  APPROVED: 'success',
  REJECTED: 'danger',
  REWORK: 'warning',
};

/** For the enums that do not warrant their own component. */
export function StateBadge({ value, namespace, className = '' }) {
  const { t } = useTranslation();
  if (!value) return null;

  return (
    <span className={`badge text-bg-${GENERIC_TONE[value] ?? 'secondary'} ${className}`}>
      {t(`${namespace}.${value}`, value)}
    </span>
  );
}
