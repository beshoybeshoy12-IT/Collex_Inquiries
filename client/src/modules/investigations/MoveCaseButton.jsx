import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { useToast } from '../../components/Toast';
import Modal from '../../components/Modal';
import { P } from '../../utils/permissions';

/**
 * The sections of the sidebar, as status groups. Mirrors `STATUS_GROUPS` in
 * `server/src/investigations/case-status.machine.ts` — presentation only; the
 * server decides every move.
 */
const SECTIONS = [
  { key: 'NEW', labelKey: 'nav.newCases', statuses: ['NEW', 'VALIDATING'] },
  { key: 'UNASSIGNED', labelKey: 'nav.unassigned', statuses: ['READY_FOR_ASSIGNMENT'] },
  { key: 'ASSIGNED', labelKey: 'nav.assigned', statuses: ['ASSIGNED', 'ACCEPTED'] },
  {
    key: 'IN_PROGRESS',
    labelKey: 'nav.inProgress',
    statuses: ['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'],
  },
  { key: 'SUBMITTED', labelKey: 'nav.submitted', statuses: ['SUBMITTED', 'AUTO_VALIDATION'] },
  { key: 'QC', labelKey: 'nav.qc', statuses: ['QC_PENDING'] },
  { key: 'REWORK', labelKey: 'nav.rework', statuses: ['QC_REJECTED', 'REWORK'] },
  {
    key: 'COMPLETED',
    labelKey: 'nav.completed',
    statuses: ['QC_APPROVED', 'REPORT_GENERATION', 'COMPLETED'],
  },
  { key: 'CLOSED', labelKey: 'nav.closed', statuses: ['CANCELLED', 'ARCHIVED'] },
];

function sectionOf(status) {
  return SECTIONS.find((section) => section.statuses.includes(status));
}

// Moves the state machine marks as needing a reason; asking first avoids a
// round trip that only returns an error.
const NEEDS_REASON = ['CANCELLED', 'REWORK', 'QC_REJECTED', 'READY_FOR_ASSIGNMENT'];

/**
 * "Move to…" for one case — on the case page and on every row of the list.
 *
 * The menu lists the moves the state machine allows for this case right now
 * (`allowedTransitions`, fetched when the menu opens), each labelled with the
 * section it lands in. Holders of `investigations.override_status` also get
 * "Exceptional move…": any status, with a written reason, audited.
 */
export default function MoveCaseButton({ caseId, size = 'sm', variant = 'outline-primary' }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(null); // { status, override }

  const canOverride = can(P.INVESTIGATIONS_OVERRIDE_STATUS);

  const { data, isLoading } = useQuery({
    queryKey: ['investigation', caseId],
    queryFn: async () => (await api.get(`/investigations/${caseId}`)).data,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const move = useMutation({
    mutationFn: async ({ status, reason, override }) =>
      (
        await api.post(`/investigations/${caseId}/transition`, {
          status,
          ...(reason ? { reason } : {}),
          ...(override ? { override: true } : {}),
        })
      ).data,
    onSuccess: (_, { status }) => {
      const section = sectionOf(status);
      toast.success(
        t('move.done', {
          section: section ? t(section.labelKey) : t(`status.${status}`, status),
        }),
      );
      setPending(null);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['investigation', caseId] });
      queryClient.invalidateQueries({ queryKey: ['investigation-timeline', caseId] });
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
    },
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage ?? t('errors.unknown'))),
  });

  const choose = (status) => {
    setOpen(false);
    if (NEEDS_REASON.includes(status)) setPending({ status, override: false });
    else move.mutate({ status });
  };

  const allowed = data?.allowedTransitions ?? [];

  return (
    // Clicks here must not reach a clickable table row underneath.
    <div
      className="dropdown d-inline-block"
      ref={containerRef}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <button
        type="button"
        className={`btn btn-${size} btn-${variant} dropdown-toggle text-nowrap`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={move.isPending}
        onClick={() => setOpen((current) => !current)}
      >
        {move.isPending ? (
          <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
        ) : (
          <i className="bi bi-arrow-left-right me-1" aria-hidden="true" />
        )}
        {t('move.button')}
      </button>

      {open && (
        <ul
          className="dropdown-menu show move-menu"
          role="menu"
          // Anchored to the button's end edge and opening inwards, so it
          // never runs off the page in either direction.
          style={{ insetInlineEnd: 0, insetInlineStart: 'auto', insetBlockStart: '100%' }}
        >
          <li>
            <h6 className="dropdown-header">
              {data
                ? t('move.from', {
                    section: sectionOf(data.status)
                      ? t(sectionOf(data.status).labelKey)
                      : t(`status.${data.status}`, data.status),
                  })
                : t('move.button')}
            </h6>
          </li>

          {isLoading ? (
            <li className="px-3 py-2 text-center">
              <span className="spinner-border spinner-border-sm" aria-hidden="true" />
            </li>
          ) : allowed.length === 0 ? (
            <li className="px-3 py-2 small text-body-secondary">{t('move.none')}</li>
          ) : (
            allowed.map((status) => {
              const section = sectionOf(status);
              return (
                <li key={status}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`dropdown-item d-flex justify-content-between gap-3 ${
                      status === 'CANCELLED' ? 'text-danger' : ''
                    }`}
                    onClick={() => choose(status)}
                  >
                    <span>{section ? t(section.labelKey) : t(`status.${status}`, status)}</span>
                    <span className="small text-body-tertiary">{t(`status.${status}`, status)}</span>
                  </button>
                </li>
              );
            })
          )}

          {canOverride && data && (
            <>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-item text-warning-emphasis"
                  onClick={() => {
                    setOpen(false);
                    setPending({ status: '', override: true });
                  }}
                >
                  <i className="bi bi-shield-exclamation me-2" aria-hidden="true" />
                  {t('move.override')}
                </button>
              </li>
            </>
          )}
        </ul>
      )}

      {pending && (
        <MoveDialog
          current={data?.status}
          hasInvestigator={Boolean(data?.investigatorId)}
          pending={pending}
          busy={move.isPending}
          onClose={() => setPending(null)}
          onConfirm={(status, reason) =>
            move.mutate({ status, reason, override: pending.override })
          }
        />
      )}
    </div>
  );
}

/** Asks for the reason (and, for an override, the target status). */
function MoveDialog({ current, hasInvestigator, pending, busy, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(pending.status);
  const [reason, setReason] = useState('');

  const fieldStatus = ['ASSIGNED', 'IN_PROGRESS'].includes(sectionOf(status)?.key);
  const valid =
    status &&
    reason.trim().length >= (pending.override ? 5 : 1) &&
    !(pending.override && fieldStatus && !hasInvestigator);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t(pending.override ? 'move.overrideTitle' : 'move.reasonTitle')}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${pending.override ? 'btn-warning' : 'btn-primary'}`}
            disabled={!valid || busy}
            onClick={() => onConfirm(status, reason.trim())}
          >
            {busy && <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />}
            {t('move.confirm')}
          </button>
        </>
      }
    >
      {pending.override && (
        <>
          <div className="alert alert-warning small py-2">
            <i className="bi bi-shield-exclamation me-1" aria-hidden="true" />
            {t('move.overrideWarning')}
          </div>
          {/* Where the case is now, said plainly before asking where to. */}
          {current && (
            <div className="move-current mb-3">
              <i className="bi bi-geo-alt-fill" aria-hidden="true" />
              <span>
                {t('move.nowIn')}{' '}
                <strong>
                  {sectionOf(current) ? t(sectionOf(current).labelKey) : t(`status.${current}`)}
                </strong>{' '}
                <span className="text-body-secondary">({t(`status.${current}`, current)})</span>
              </span>
            </div>
          )}
          <label className="form-label" htmlFor="move-status">
            {t('move.target')}
          </label>
          <select
            id="move-status"
            className="form-select mb-2"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t('move.chooseTarget')}</option>
            {/* The current status is left out; a section with nothing else in
                it is left out with it, so no heading stands empty. */}
            {SECTIONS.map((section) => {
              const targets = section.statuses.filter((s) => s !== current);
              if (targets.length === 0) return null;
              return (
                <optgroup key={section.key} label={t(section.labelKey)}>
                  {targets.map((s) => (
                    <option key={s} value={s}>
                      {t(`status.${s}`, s)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {fieldStatus && !hasInvestigator && (
            <div className="small text-danger mb-2">{t('move.needsInvestigator')}</div>
          )}
        </>
      )}

      <label className="form-label" htmlFor="move-reason">
        {t('move.reason')}
      </label>
      <textarea
        id="move-reason"
        className="form-control"
        rows={3}
        maxLength={1000}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {pending.override && <div className="form-text">{t('move.reasonHint')}</div>}
    </Modal>
  );
}
