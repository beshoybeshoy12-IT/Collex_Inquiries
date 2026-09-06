import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedLabel, localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useQcReasons } from '../../hooks/useCatalog';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { PriorityBadge, StatusBadge } from '../../components/Badges';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The QC review screen.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  EVERYTHING A REVIEWER NEEDS ON ONE SCREEN, in one request: the answers, the
 *  evidence, the GPS track, the automatic checks and every previous verdict.
 *  A reviewer working a queue of forty cases cannot spend six round trips per
 *  case, and a decision made without the previous rejection in view is how a
 *  case gets sent back twice for the same thing.
 *
 *  THE AUTOMATIC CHECKS ARE SHOWN FIRST because they are the fastest way to
 *  see whether this needs a careful look or a quick approval.
 *
 *  A REJECTION MUST NAME A REASON. The reasons are configured rows, not free
 *  text, so the rejection-rate report is countable — which is the entire point
 *  of having them.
 */
export default function QcReview() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [decision, setDecision] = useState(null);
  const [reasonIds, setReasonIds] = useState([]);
  const [comment, setComment] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['qc-packet', id],
    queryFn: async () => (await api.get(`/qc/${id}`)).data,
  });

  const { data: reasons } = useQcReasons();

  const decide = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/qc/${id}/decision`, {
          decision,
          reasonIds: reasonIds.length > 0 ? reasonIds : undefined,
          comment: comment.trim() || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      queryClient.invalidateQueries({ queryKey: ['qc-queue'] });
      queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
      navigate('/qc');
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-4 d-block mb-3" style={{ height: 32 }} />
        <span className="placeholder col-12 d-block" style={{ height: 320 }} />
      </div>
    );
  }

  const { investigation, submission, media, gpsEvents, previousReviews, autoValidation } =
    data;

  const needsReason = decision && decision !== 'APPROVED';
  const reasonRequired =
    needsReason && reasonIds.length === 0 && comment.trim().length === 0;

  // A reason flagged `needsNote` forces an explanation — the server enforces
  // it, and checking here avoids a round trip that only produces an error.
  const noteRequired =
    needsReason &&
    reasonIds.some(
      (reasonId) => (reasons ?? []).find((r) => r.id === reasonId)?.needsNote,
    ) &&
    comment.trim().length === 0;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/qc" className="small text-decoration-none">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            {t('qc.queue')}
          </Link>
        }
        title={
          <span className="d-flex align-items-center gap-2 flex-wrap">
            <span className="mono">{investigation.caseNumber}</span>
            <StatusBadge status={investigation.status} />
            <PriorityBadge priority={investigation.priority} />
          </span>
        }
        subtitle={investigation.customer?.fullName}
        actions={
          <Link
            to={`/investigations/${investigation.id}`}
            className="btn btn-sm btn-outline-secondary"
          >
            {t('cases.case')}
          </Link>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-xl-8">
          {/* ── Automatic checks ─────────────────────────────────────────── */}
          {autoValidation && (
            <div
              className={`alert py-2 px-3 ${
                autoValidation.passed ? 'alert-success' : 'alert-warning'
              }`}
            >
              <span className="fw-semibold">
                <i
                  className={`bi bi-${
                    autoValidation.passed ? 'check-circle' : 'exclamation-triangle'
                  } me-1`}
                  aria-hidden="true"
                />
                {autoValidation.passed ? t('qc.autoPassed') : t('qc.autoFailed')}
              </span>
              {autoValidation.problems?.length > 0 && (
                <ul className="mb-0 mt-1 ps-3 small">
                  {autoValidation.problems.map((problem, index) => (
                    <li key={index}>
                      {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Answers ──────────────────────────────────────────────────── */}
          <Panel title={t('qc.answers')} className="mb-3">
            {!submission ? (
              <EmptyState title={t('common.empty')} icon="ui-checks" />
            ) : (
              <AnswerSections
                schema={submission.formVersion?.schema}
                answers={submission.answers ?? {}}
                language={i18n.language}
              />
            )}
          </Panel>

          {/* ── Evidence ─────────────────────────────────────────────────── */}
          <Panel title={t('qc.evidence')} className="mb-3">
            {media.length === 0 ? (
              <EmptyState title={t('media.noPhotos')} icon="camera" />
            ) : (
              <div className="evidence-grid">
                {media.map((asset) => (
                  <figure key={asset.id} className="evidence-tile mb-0">
                    <EvidenceThumb assetId={asset.id} alt={asset.fileName} />
                    <figcaption className="small mt-1 truncate">
                      {asset.category
                        ? localisedName(asset.category, i18n.language)
                        : asset.fileName}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Panel>

          {/* ── GPS ──────────────────────────────────────────────────────── */}
          <Panel title={t('qc.gpsEvidence')}>
            {gpsEvents.length === 0 ? (
              <p className="text-body-secondary small mb-0">{t('gps.noEvents')}</p>
            ) : (
              <ul className="list-unstyled mb-0 small">
                {gpsEvents.map((event) => (
                  <li
                    key={event.id}
                    className="d-flex justify-content-between align-items-center py-1 border-bottom"
                  >
                    <span>
                      <span className="badge text-bg-light me-2">{event.eventType}</span>
                      <a
                        className="mono text-decoration-none"
                        href={`https://www.google.com/maps?q=${event.lat},${event.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {event.lat.toFixed(5)}, {event.lng.toFixed(5)}
                      </a>
                    </span>
                    <span>
                      {event.distanceFromTargetM != null && (
                        <span
                          className={
                            event.distanceFromTargetM > 2000
                              ? 'text-danger fw-semibold me-2'
                              : 'text-success me-2'
                          }
                        >
                          {t('qc.distanceFromTarget', {
                            metres: event.distanceFromTargetM,
                          })}
                        </span>
                      )}
                      <span className="text-body-secondary">
                        {new Date(event.recordedAt).toLocaleString(i18n.language)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* ── Decision panel ─────────────────────────────────────────────── */}
        <div className="col-12 col-xl-4">
          <Panel title={t('qc.decision')} className="mb-3">
            <Field label={t('cases.investigator')}>
              {investigation.investigator?.fullName}
              {investigation.investigator?.qualityScore != null && (
                <span className="badge text-bg-light ms-2">
                  {Number(investigation.investigator.qualityScore)}%
                </span>
              )}
            </Field>
            <Field label={t('status.SUBMITTED')}>
              {investigation.submittedAt
                ? new Date(investigation.submittedAt).toLocaleString(i18n.language)
                : '—'}
            </Field>
            {investigation.reworkCount > 0 && (
              <Field label={t('cases.reworkCount')}>
                <span className="badge text-bg-warning">
                  {investigation.reworkCount}
                </span>
              </Field>
            )}

            <hr />

            <div className="d-grid gap-2">
              {can(P.QC_APPROVE) && (
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={() => setDecision('APPROVED')}
                  disabled={investigation.status !== 'QC_PENDING'}
                >
                  <i className="bi bi-check-lg me-1" aria-hidden="true" />
                  {t('qc.approve')}
                </button>
              )}
              {can(P.QC_REWORK) && (
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() => setDecision('REWORK')}
                  disabled={investigation.status !== 'QC_PENDING'}
                >
                  <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
                  {t('qc.requestRework')}
                </button>
              )}
              {can(P.QC_REJECT) && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setDecision('REJECTED')}
                  disabled={investigation.status !== 'QC_PENDING'}
                >
                  <i className="bi bi-x-lg me-1" aria-hidden="true" />
                  {t('qc.reject')}
                </button>
              )}
            </div>

            {investigation.status !== 'QC_PENDING' && (
              <p className="small text-body-secondary mt-2 mb-0">
                {t('status.' + investigation.status)}
              </p>
            )}
          </Panel>

          {previousReviews.length > 0 && (
            <Panel title={t('qc.previousReviews')}>
              <ul className="list-unstyled mb-0 small">
                {previousReviews.map((review) => (
                  <li key={review.id} className="border-bottom py-2">
                    <span
                      className={`badge text-bg-${
                        review.decision === 'APPROVED' ? 'success' : 'danger'
                      }`}
                    >
                      {t(`qc.${review.decision.toLowerCase()}`, review.decision)}
                    </span>
                    <span className="ms-2 text-body-secondary">
                      {t('qc.attempt', { n: review.attempt })}
                    </span>
                    {review.comment && <div className="mt-1">{review.comment}</div>}
                    {review.reasons?.length > 0 && (
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {review.reasons.map((entry) => (
                          <span key={entry.reasonId} className="badge text-bg-light">
                            {localisedName(entry.reason, i18n.language)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-body-tertiary" style={{ fontSize: '.72rem' }}>
                      {review.reviewer?.fullName} ·{' '}
                      {new Date(review.reviewedAt).toLocaleString(i18n.language)}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {/* ── Decision dialog ──────────────────────────────────────────────── */}
      <Modal
        open={Boolean(decision)}
        onClose={() => {
          setDecision(null);
          setReasonIds([]);
          setComment('');
        }}
        title={
          decision === 'APPROVED'
            ? t('qc.approve')
            : decision === 'REWORK'
              ? t('qc.requestRework')
              : t('qc.reject')
        }
        busy={decide.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setDecision(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={`btn btn-${decision === 'APPROVED' ? 'success' : 'danger'}`}
              onClick={() => decide.mutate()}
              disabled={reasonRequired || noteRequired || decide.isPending}
            >
              {decide.isPending && (
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              )}
              {t('common.confirm')}
            </button>
          </>
        }
      >
        {needsReason && (
          <div className="mb-3">
            <label className="form-label small fw-semibold">{t('qc.reasons')}</label>
            <p className="small text-body-secondary">{t('qc.reasonsHint')}</p>

            <div className="d-flex flex-column gap-1">
              {(reasons ?? []).map((reason) => (
                <div className="form-check" key={reason.id}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`reason-${reason.id}`}
                    checked={reasonIds.includes(reason.id)}
                    onChange={(event) =>
                      setReasonIds((current) =>
                        event.target.checked
                          ? [...current, reason.id]
                          : current.filter((value) => value !== reason.id),
                      )
                    }
                  />
                  <label className="form-check-label small" htmlFor={`reason-${reason.id}`}>
                    {localisedName(reason, i18n.language)}
                    {reason.needsNote && (
                      <span className="badge text-bg-light ms-1">
                        {t('qc.needsNote')}
                      </span>
                    )}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="form-label small fw-semibold" htmlFor="qc-comment">
          {t('qc.comment')}
          {noteRequired && <span className="text-danger ms-1">*</span>}
        </label>
        <textarea
          id="qc-comment"
          className="form-control"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        {noteRequired && (
          <div className="form-text text-danger small">{t('qc.commentRequired')}</div>
        )}
        {reasonRequired && (
          <div className="form-text text-danger small">{t('qc.reasonsHint')}</div>
        )}
      </Modal>
    </>
  );
}

function AnswerSections({ schema, answers, language }) {
  const { t } = useTranslation();
  if (!schema?.sections) return <p className="small text-body-secondary">—</p>;

  return (
    <div className="d-flex flex-column gap-3">
      {schema.sections.map((section) => {
        const fields = (section.fields ?? []).filter(
          (field) => field.type !== 'SECTION_NOTE',
        );
        if (fields.length === 0) return null;

        return (
          <div key={section.key}>
            <h3 className="h6 small text-uppercase text-body-secondary">
              {localisedLabel(section, language)}
            </h3>
            <dl className="row mb-0">
              {fields.map((field) => {
                const value = answers[field.key];
                const empty =
                  value === null ||
                  value === undefined ||
                  value === '' ||
                  (Array.isArray(value) && value.length === 0);

                return (
                  <div className="col-12 col-md-6 mb-2" key={field.key}>
                    <dt className="small text-body-secondary fw-normal">
                      {localisedLabel(field, language)}
                    </dt>
                    <dd className="mb-0 fw-medium">
                      {empty ? (
                        <span className="text-body-tertiary">
                          {field.required ? (
                            <span className="text-danger">{t('common.required')}</span>
                          ) : (
                            '—'
                          )}
                        </span>
                      ) : (
                        renderAnswer(field, value, language)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function renderAnswer(field, value, language) {
  if (['PHOTO', 'FILE', 'SIGNATURE'].includes(field.type)) {
    const count = Array.isArray(value) ? value.length : 1;
    return <span className="badge text-bg-light">{count}</span>;
  }

  if (field.options?.length) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((item) => {
        const option = field.options.find((candidate) => candidate.value === String(item));
        return option ? localisedLabel(option, language) : String(item);
      })
      .join('، ');
  }

  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function EvidenceThumb({ assetId, alt }) {
  const { data, isLoading } = useQuery({
    queryKey: ['media-url', assetId],
    queryFn: async () => (await api.get(`/media/${assetId}/download`)).data,
    staleTime: 10 * 60_000,
    retry: false,
  });

  if (isLoading || !data?.url) {
    return <span className="placeholder d-block rounded w-100" style={{ height: 130 }} />;
  }

  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer">
      <img
        src={data.url}
        alt={alt}
        style={{ width: '100%', height: 130, objectFit: 'cover' }}
        className="rounded"
        loading="lazy"
      />
    </a>
  );
}
