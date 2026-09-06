import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useGovernorates } from '../../hooks/useCatalog';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { AvailabilityBadge, StateBadge } from '../../components/Badges';
import CredentialDialog from '../../components/CredentialDialog';

export default function InvestigatorDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [confirming, setConfirming] = useState(null);
  const [credential, setCredential] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investigator', id],
    queryFn: async () => (await api.get(`/investigators/${id}`)).data,
  });

  const { data: performance } = useQuery({
    queryKey: ['investigator-performance', id],
    queryFn: async () => (await api.get(`/investigators/${id}/performance`)).data,
    enabled: can(P.INVESTIGATORS_VIEW_PERFORMANCE),
  });

  const { data: governorates } = useGovernorates();

  const setStatus = useMutation({
    mutationFn: async (status) =>
      (await api.patch(`/investigators/${id}/status`, { status })).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['investigator', id] });
      queryClient.invalidateQueries({ queryKey: ['investigators-list'] });
    },
    onError: (mutationError) => {
      // The server refuses to deactivate somebody holding live cases and says
      // how many — that is the actionable half of the message.
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
      setConfirming(null);
    },
  });

  const resetPassword = useMutation({
    mutationFn: async () =>
      (await api.post(`/investigators/${id}/reset-password`)).data,
    onSuccess: (result) => {
      setConfirming(null);
      setCredential({
        title: data.fullName,
        identifier: data.employeeCode,
        password: result.temporaryPassword,
      });
    },
    onError: (mutationError) => toast.error(mutationError),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-4 d-block mb-3" style={{ height: 32 }} />
        <span className="placeholder col-12 d-block" style={{ height: 280 }} />
      </div>
    );
  }

  const coverage = (governorates ?? []).filter((governorate) =>
    data.governorateIds?.includes(governorate.id),
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/investigators" className="small text-decoration-none">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            {t('investigators.title')}
          </Link>
        }
        title={
          <span className="d-flex align-items-center gap-2 flex-wrap">
            {data.fullName}
            <StateBadge value={data.status} namespace="investigatorStatus" />
            <AvailabilityBadge availability={data.availability} />
          </span>
        }
        subtitle={
          <span className="mono">
            {data.employeeCode} · {data.phone}
          </span>
        }
        actions={
          <>
            {can(P.INVESTIGATORS_RESET_PASSWORD) && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setConfirming({ kind: 'reset' })}
              >
                {t('investigators.resetPassword')}
              </button>
            )}
            {can(P.INVESTIGATORS_DISABLE) &&
              (data.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => setConfirming({ kind: 'status', status: 'INACTIVE' })}
                >
                  {t('users.disable')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-success"
                  onClick={() => setConfirming({ kind: 'status', status: 'ACTIVE' })}
                >
                  {t('users.enable')}
                </button>
              ))}
          </>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-lg-4">
          <Panel title={t('investigators.investigator')} className="mb-3">
            <Field label={t('assignment.openCases')}>
              <div className="d-flex align-items-center gap-2">
                <div className="progress flex-grow-1" style={{ height: 6 }}>
                  <div
                    className={`progress-bar ${data.atCapacity ? 'bg-danger' : 'bg-success'}`}
                    style={{ width: `${Math.min(100, data.capacityUsedPercent ?? 0)}%` }}
                  />
                </div>
                <span className="small">
                  {data.openCases}/{data.maxOpenCases}
                </span>
              </div>
            </Field>
            <Field label={t('investigators.maxDailyCases')}>{data.maxDailyCases}</Field>
            <Field label={t('investigators.qualityScore')}>
              {data.qualityScore != null ? `${data.qualityScore}%` : null}
            </Field>
            <Field label={t('investigators.lastActivity')}>
              {data.lastActivityAt
                ? new Date(data.lastActivityAt).toLocaleString(i18n.language)
                : null}
            </Field>
            {data.lastLat != null && (
              <Field label={t('investigators.lastLocation')}>
                <a
                  className="mono text-decoration-none"
                  href={`https://www.google.com/maps?q=${data.lastLat},${data.lastLng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {Number(data.lastLat).toFixed(5)}, {Number(data.lastLng).toFixed(5)}
                </a>
              </Field>
            )}
            <Field label={t('investigators.device')}>
              {data.deviceModel ? `${data.deviceModel} (${data.devicePlatform})` : null}
            </Field>
          </Panel>

          <Panel title={t('investigators.coverage')}>
            <div className="d-flex flex-wrap gap-1">
              {coverage.length === 0 ? (
                <span className="badge text-bg-light">{t('common.all')}</span>
              ) : (
                coverage.map((governorate) => (
                  <span key={governorate.id} className="badge text-bg-light">
                    {localisedName(governorate, i18n.language)}
                  </span>
                ))
              )}
            </div>
          </Panel>
        </div>

        <div className="col-12 col-lg-8">
          {performance && (
            <Panel title={t('investigators.performance')} className="mb-3">
              <div className="row text-center g-3">
                <MetricCell
                  label={t('investigators.completedCount')}
                  value={performance.completedCases}
                />
                <MetricCell
                  label={t('investigators.qcApprovalRate')}
                  value={
                    performance.qcApprovalRate != null
                      ? `${performance.qcApprovalRate}%`
                      : '—'
                  }
                  tone={
                    performance.qcApprovalRate >= 85
                      ? 'success'
                      : performance.qcApprovalRate >= 70
                        ? 'warning'
                        : 'danger'
                  }
                />
                <MetricCell
                  label={t('investigators.slaComplianceRate')}
                  value={
                    performance.slaComplianceRate != null
                      ? `${performance.slaComplianceRate}%`
                      : '—'
                  }
                  tone={
                    performance.slaComplianceRate >= 90
                      ? 'success'
                      : performance.slaComplianceRate >= 75
                        ? 'warning'
                        : 'danger'
                  }
                />
                <MetricCell
                  label={t('investigators.avgTat')}
                  value={
                    performance.avgFieldMinutes != null
                      ? `${Math.round(performance.avgFieldMinutes / 60)}h`
                      : '—'
                  }
                />
              </div>

              {performance.qcReviewed > 0 && (
                <p className="small text-body-secondary mt-3 mb-0">
                  {t('qc.reviewed')}: {performance.qcReviewed} ·{' '}
                  {t('nav.rejected')}: {performance.qcRejections}
                </p>
              )}
            </Panel>
          )}

          <Panel title={t('cases.title')}>
            <div className="d-flex flex-wrap gap-2">
              {Object.entries(performance?.caseCounts ?? {}).map(([status, count]) => (
                <Link
                  key={status}
                  to={`/investigations?investigatorId=${id}&status=${status}`}
                  className="text-decoration-none"
                >
                  <span className="badge text-bg-light">
                    {t(`status.${status}`, status)}: {count}
                  </span>
                </Link>
              ))}
              {!performance?.totalCases && (
                <span className="text-body-secondary small">{t('common.empty')}</span>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming.kind === 'reset') resetPassword.mutate();
          else setStatus.mutate(confirming.status);
        }}
        title={
          confirming?.kind === 'reset'
            ? t('investigators.resetPassword')
            : t('common.confirm')
        }
        message={
          confirming?.kind === 'reset'
            ? t('investigators.temporaryPasswordHint')
            : confirming?.status === 'ACTIVE'
              ? t('users.enable')
              : t('investigators.openCasesFirst')
        }
        tone={confirming?.status === 'ACTIVE' ? 'success' : 'danger'}
        busy={setStatus.isPending || resetPassword.isPending}
      />

      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />
    </>
  );
}

function MetricCell({ label, value, tone }) {
  return (
    <div className="col-6 col-md-3">
      <div className={`fs-4 fw-semibold ${tone ? `text-${tone}` : ''}`}>{value}</div>
      <div className="small text-body-secondary">{label}</div>
    </div>
  );
}
