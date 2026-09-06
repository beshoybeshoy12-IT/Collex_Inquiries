import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { useToast } from '../../components/Toast';
import { StatusBadge } from '../../components/Badges';

/**
 * The case timeline: status changes, comments and assignments, merged in time
 * order by the server.
 *
 * Comments are posted from here rather than from a separate screen, because a
 * note about a case is almost always written while reading its history.
 *
 * An internal note is visually distinct AND labelled. Colour alone would leave
 * a coordinator unsure whether the investigator can see what they just wrote,
 * which is the one thing that must never be ambiguous about this flag.
 */
export default function CaseTimeline({ investigationId }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investigation-timeline', investigationId],
    queryFn: async () =>
      (await api.get(`/investigations/${investigationId}/timeline`)).data,
  });

  const comment = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/investigations/${investigationId}/comments`, {
          body,
          isInternal: internal,
        })
      ).data,
    onSuccess: () => {
      setBody('');
      queryClient.invalidateQueries({
        queryKey: ['investigation-timeline', investigationId],
      });
    },
    onError: (mutationError) => toast.error(mutationError),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="row g-3">
      <div className="col-12 col-lg-8">
        <div className="card">
          <div className="card-body">
            {isLoading ? (
              <div className="placeholder-glow">
                {[1, 2, 3, 4].map((n) => (
                  <span
                    key={n}
                    className="placeholder col-12 d-block mb-3"
                    style={{ height: 40 }}
                  />
                ))}
              </div>
            ) : !data?.length ? (
              <EmptyState title={t('common.empty')} icon="clock-history" />
            ) : (
              <ul className="timeline">
                {data.map((event, index) => (
                  <li
                    key={`${event.kind}-${index}`}
                    className={`timeline__item ${
                      event.kind === 'COMMENT' ? 'timeline__item--muted' : ''
                    }`}
                  >
                    <div className="d-flex justify-content-between align-items-baseline gap-2 flex-wrap">
                      <div className="min-vw-0">
                        {event.kind === 'STATUS' && (
                          <span className="d-flex align-items-center gap-2 flex-wrap">
                            {event.fromStatus && (
                              <>
                                <StatusBadge status={event.fromStatus} />
                                <i className="bi bi-arrow-right small" aria-hidden="true" />
                              </>
                            )}
                            <StatusBadge status={event.toStatus} />
                          </span>
                        )}

                        {event.kind === 'ASSIGNMENT' && (
                          <span>
                            <i className="bi bi-person-check me-1" aria-hidden="true" />
                            {t('assignment.assigned', { name: event.investigatorName })}
                            <span className="badge text-bg-light ms-2">
                              {t(`assignment.${event.status?.toLowerCase()}`, event.status)}
                            </span>
                          </span>
                        )}

                        {event.kind === 'COMMENT' && (
                          <div>
                            {event.isInternal && (
                              <span className="badge text-bg-secondary me-2">
                                <i className="bi bi-eye-slash me-1" aria-hidden="true" />
                                {t('common.notes')}
                              </span>
                            )}
                            <span style={{ whiteSpace: 'pre-line' }}>{event.body}</span>
                          </div>
                        )}

                        {event.reason && (
                          <div className="small text-body-secondary mt-1">
                            {event.reason}
                          </div>
                        )}
                      </div>

                      <div className="small text-body-secondary text-nowrap">
                        {event.actorName ?? '—'}
                        {' · '}
                        {new Date(event.at).toLocaleString(i18n.language)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {can(P.INVESTIGATIONS_COMMENT) && (
        <div className="col-12 col-lg-4">
          <div className="card">
            <div className="card-body">
              <label className="form-label small fw-semibold" htmlFor="new-comment">
                {t('common.notes')}
              </label>
              <textarea
                id="new-comment"
                className="form-control form-control-sm mb-2"
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />

              <div className="form-check mb-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="internal-note"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                />
                <label className="form-check-label small" htmlFor="internal-note">
                  <i className="bi bi-eye-slash me-1" aria-hidden="true" />
                  {t('common.notes')} — {t('cases.investigator')}: {t('common.no')}
                </label>
              </div>

              <button
                type="button"
                className="btn btn-sm btn-primary w-100"
                onClick={() => comment.mutate()}
                disabled={body.trim().length === 0 || comment.isPending}
              >
                {comment.isPending && (
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    aria-hidden="true"
                  />
                )}
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
