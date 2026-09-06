import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { localiseServerMessage } from '../../services/api';

/**
 * Assign one case or many.
 *
 * WHEN EXACTLY ONE CASE IS SELECTED, the ranked suggestions are shown. That
 * ranking is per-case — it scores coverage and proximity against that case's
 * address — so it is meaningless for a bulk selection spanning four
 * governorates, and showing it anyway would be a confident-looking
 * recommendation with nothing behind it. Bulk assignment gets the plain list.
 *
 * The suggestions are advisory. The coordinator picks; nothing here assigns on
 * its own, which is the business rule the whole assignment model is built
 * around.
 */
export default function AssignModal({
  open,
  onClose,
  investigationIds = [],
  onDone,
  mode = 'assign',
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const [investigatorId, setInvestigatorId] = useState('');
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const [notes, setNotes] = useState('');

  const single = investigationIds.length === 1;
  const isReassign = mode === 'reassign';

  useEffect(() => {
    if (open) {
      setInvestigatorId('');
      setReason('');
      setForce(false);
      setNotes('');
    }
  }, [open]);

  // Ranked candidates, only when there is one case to rank against.
  const { data: suggestions, isLoading: loadingSuggestions } = useQuery({
    queryKey: ['assignment-suggestions', investigationIds[0]],
    queryFn: async () =>
      (
        await api.get('/assignments/suggest', {
          params: { investigationId: investigationIds[0], limit: 12 },
        })
      ).data,
    enabled: open && single,
  });

  // The plain workload list, for bulk.
  const { data: workload, isLoading: loadingWorkload } = useQuery({
    queryKey: ['assignment-workload'],
    queryFn: async () => (await api.get('/assignments/workload')).data,
    enabled: open && !single,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (isReassign) {
        return (
          await api.post('/assignments/reassign', {
            investigationId: investigationIds[0],
            investigatorId,
            reason,
            force,
          })
        ).data;
      }

      if (single) {
        return (
          await api.post('/assignments', {
            investigationId: investigationIds[0],
            investigatorId,
            notes: notes || undefined,
            force,
          })
        ).data;
      }

      return (
        await api.post('/assignments/bulk', {
          investigationIds,
          investigatorId,
          notes: notes || undefined,
          force,
        })
      ).data;
    },
    onSuccess: (result) => {
      if (result?.assigned !== undefined) {
        toast.success(
          t('assignment.bulkResult', {
            assigned: result.assigned,
            skipped: result.skipped,
          }),
        );
        // A partial result is worth naming: the coordinator has to know which
        // cases still need a home.
        if (result.skipped > 0) {
          const first = result.details?.skipped?.[0];
          if (first) {
            toast.warning(first.reasons.join(' · '));
          }
        }
      } else {
        toast.success(t('common.saved'));
      }
      onDone?.();
      onClose();
    },
    onError: (error) => {
      const reasons = error.details?.reasons;
      toast.error(
        reasons?.length
          ? reasons.map(localiseServerMessage).join('\n')
          : localiseServerMessage(error.friendlyMessage),
      );
    },
  });

  const candidates = single
    ? (suggestions ?? []).map((suggestion) => ({
        id: suggestion.investigatorId,
        fullName: suggestion.fullName,
        employeeCode: suggestion.employeeCode,
        openCases: suggestion.openCases,
        maxOpenCases: suggestion.maxOpenCases,
        eligible: suggestion.eligible,
        score: suggestion.score,
        blockers: suggestion.blockers,
        notes: suggestion.notes,
        factors: suggestion.factors,
      }))
    : (workload ?? []).map((row) => ({
        id: row.id,
        fullName: row.fullName,
        employeeCode: row.employeeCode,
        openCases: row.openCases,
        maxOpenCases: row.maxOpenCases,
        eligible: !row.atCapacity,
        blockers: row.atCapacity ? [t('assignment.atCapacity')] : [],
      }));

  const chosen = candidates.find((candidate) => candidate.id === investigatorId);
  const loading = single ? loadingSuggestions : loadingWorkload;

  const canSubmit =
    investigatorId &&
    (!isReassign || reason.trim().length > 0) &&
    (chosen?.eligible || force);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="modal-lg"
      title={
        isReassign
          ? t('assignment.reassign')
          : `${t('assignment.assign')} · ${investigationIds.length} ${t('cases.case')}`
      }
      busy={submit.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onClose}
            disabled={submit.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit.mutate()}
            disabled={!canSubmit || submit.isPending}
          >
            {submit.isPending && (
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            )}
            {isReassign ? t('assignment.reassign') : t('assignment.assign')}
          </button>
        </>
      }
    >
      {isReassign && (
        <div className="mb-3">
          <label className="form-label small fw-semibold" htmlFor="reassign-reason">
            {t('assignment.reassignReason')} <span className="text-danger">*</span>
          </label>
          <textarea
            id="reassign-reason"
            className="form-control form-control-sm"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {reason.trim().length === 0 && (
            <div className="form-text text-danger small">
              {t('assignment.reassignReasonRequired')}
            </div>
          )}
        </div>
      )}

      <div className="mb-2 d-flex align-items-baseline justify-content-between">
        <label className="form-label small fw-semibold mb-0">
          {single ? t('assignment.suggested') : t('assignment.assignTo')}
        </label>
        {single && (
          <span className="small text-body-secondary">{t('assignment.suggestedHint')}</span>
        )}
      </div>

      {loading ? (
        <div className="placeholder-glow">
          {[1, 2, 3].map((n) => (
            <span key={n} className="placeholder col-12 d-block mb-2" style={{ height: 54 }} />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-body-secondary small">{t('assignment.noInvestigators')}</p>
      ) : (
        <div className="list-group" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {candidates.map((candidate) => (
            <label
              key={candidate.id}
              className={`list-group-item list-group-item-action d-flex gap-2 ${
                candidate.eligible ? '' : 'opacity-75'
              }`}
              style={{ cursor: 'pointer' }}
            >
              <input
                type="radio"
                className="form-check-input flex-shrink-0 mt-1"
                name="investigator"
                value={candidate.id}
                checked={investigatorId === candidate.id}
                onChange={() => setInvestigatorId(candidate.id)}
              />

              <div className="flex-grow-1 min-vw-0">
                <div className="d-flex justify-content-between align-items-baseline gap-2">
                  <span className="fw-medium truncate">{candidate.fullName}</span>
                  {candidate.score != null && (
                    <span className="badge text-bg-light flex-shrink-0">
                      {t('assignment.score')} {candidate.score}
                    </span>
                  )}
                </div>

                <div className="small text-body-secondary">
                  <span className="mono">{candidate.employeeCode}</span>
                  {' · '}
                  {t('assignment.openCases')}: {candidate.openCases}/{candidate.maxOpenCases}
                </div>

                {candidate.blockers?.length > 0 && (
                  <div className="small text-danger mt-1">
                    {candidate.blockers.map(localiseServerMessage).join(' · ')}
                  </div>
                )}

                {candidate.notes?.length > 0 && (
                  <div className="small text-body-tertiary">
                    {candidate.notes.join(' · ')}
                  </div>
                )}

                {candidate.factors && investigatorId === candidate.id && (
                  <div className="d-flex flex-wrap gap-2 small mt-2">
                    {[
                      ['coverage', t('assignment.coverage')],
                      ['skills', t('assignment.skills')],
                      ['workload', t('assignment.workloadFactor')],
                      ['quality', t('assignment.quality')],
                      ['proximity', t('assignment.proximity')],
                    ].map(([key, label]) => (
                      <span key={key} className="badge text-bg-light">
                        {label} {Math.round((candidate.factors[key] ?? 0) * 100)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {chosen && !chosen.eligible && (
        <div className="form-check mt-3">
          <input
            className="form-check-input"
            type="checkbox"
            id="force-assign"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
          />
          <label className="form-check-label small" htmlFor="force-assign">
            <span className="fw-semibold text-warning-emphasis">
              {t('assignment.forceAssign')}
            </span>
            <span className="d-block text-body-secondary">{t('assignment.forceHint')}</span>
          </label>
        </div>
      )}

      {!isReassign && (
        <div className="mt-3">
          <label className="form-label small fw-semibold" htmlFor="assign-notes">
            {t('common.notes')}
          </label>
          <textarea
            id="assign-notes"
            className="form-control form-control-sm"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}
