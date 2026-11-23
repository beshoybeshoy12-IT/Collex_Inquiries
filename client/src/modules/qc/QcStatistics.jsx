import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Doughnut } from 'react-chartjs-2';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import useChartTheme from '../../hooks/useChartTheme';

/**
 * QC quality statistics.
 *
 * THE REJECTION REASONS ARE THE POINT. An approval rate on its own says
 * something is wrong; a ranked list of why says what to fix — which is the
 * whole reason rejection reasons are configured rows rather than free text.
 */
export default function QcStatistics() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(30);
  const chart = useChartTheme();

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['qc-statistics', range],
    queryFn: async () => (await api.get('/qc/statistics', { params: range })).data,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={t('qc.statistics')}
        actions={
          <div className="btn-group btn-group-sm">
            {[7, 30, 90].map((value) => (
              <button
                key={value}
                type="button"
                className={`btn btn-outline-secondary ${days === value ? 'active' : ''}`}
                onClick={() => setDays(value)}
              >
                {value}d
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div className="placeholder-glow">
          <span className="placeholder col-12 d-block" style={{ height: 260 }} />
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-6 col-md-3">
            <div className="stat-card">
              <div className="stat-card__label">{t('qc.reviewed')}</div>
              <div className="stat-card__value">{data.reviewed}</div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="stat-card">
              <div className="stat-card__label">{t('dashboard.qcApprovalRate')}</div>
              <div className="stat-card__value text-success">
                {data.approvalRate != null ? `${data.approvalRate}%` : '—'}
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="stat-card">
              <div className="stat-card__label">{t('dashboard.qcRejectionRate')}</div>
              <div className="stat-card__value text-danger">
                {data.rejectionRate != null ? `${data.rejectionRate}%` : '—'}
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="stat-card">
              <div className="stat-card__label">{t('qc.queue')}</div>
              <div className="stat-card__value text-warning">{data.pendingReview}</div>
            </div>
          </div>

          <div className="col-12 col-lg-5">
            <Panel title={t('qc.decision')}>
              {data.reviewed === 0 ? (
                <EmptyState title={t('dashboard.noData')} icon="patch-check" />
              ) : (
                <div style={{ height: 240 }}>
                  <Doughnut
                    key={chart.theme}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: 'bottom' } },
                    }}
                    data={{
                      labels: [
                        t('nav.approved'),
                        t('nav.rejected'),
                        t('nav.rework'),
                      ],
                      datasets: [
                        {
                          data: [data.approved, data.rejected, data.rework],
                          backgroundColor: [chart.series[1], chart.series[2], chart.series[3]],
                          borderWidth: 0,
                        },
                      ],
                    }}
                  />
                </div>
              )}
            </Panel>
          </div>

          <div className="col-12 col-lg-7">
            <Panel title={t('qc.topReasons')}>
              {!data.topReasons?.length ? (
                <EmptyState title={t('dashboard.noData')} icon="list-check" />
              ) : (
                <ul className="list-unstyled mb-0">
                  {data.topReasons.map((reason) => {
                    const max = data.topReasons[0].count || 1;
                    return (
                      <li key={reason.code} className="mb-2">
                        <div className="d-flex justify-content-between small">
                          <span>{localisedName(reason, i18n.language)}</span>
                          <span className="fw-semibold">{reason.count}</span>
                        </div>
                        <div className="progress" style={{ height: 5 }}>
                          <div
                            className="progress-bar bg-danger"
                            style={{ width: `${(reason.count / max) * 100}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
