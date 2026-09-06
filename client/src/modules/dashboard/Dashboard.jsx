import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';

Chart.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

/**
 * The coordinator dashboard.
 *
 * Everything here comes from ONE request. Six endpoints would mean six loading
 * states resolving at different moments, and a page that visibly assembles
 * itself reads as slow even when the total time is the same.
 *
 * The figures are already narrowed to what this user may see — the server
 * applies the same visibility rule the case list does — so the dashboard cannot
 * become a side channel for cases the list is filtering out.
 */
export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState(30);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - period * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [period]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', range],
    queryFn: async () => (await api.get('/dashboard', { params: range })).data,
    refetchInterval: 120_000,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { rtl: i18n.language === 'ar' },
    },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
    },
  };

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <div className="btn-group btn-group-sm" role="group">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                className={`btn btn-outline-secondary ${period === days ? 'active' : ''}`}
                onClick={() => setPeriod(days)}
              >
                {days === 7
                  ? t('common.last7Days')
                  : days === 30
                    ? t('common.last30Days')
                    : `90 ${t('common.of')}`}
              </button>
            ))}
          </div>
        }
      />

      {/* ── Headline figures ─────────────────────────────────────────────── */}
      <div className="row g-3 mb-3">
        <StatTile
          label={t('dashboard.totalCases')}
          value={data?.totals?.all}
          loading={isLoading}
          to="/investigations"
        />
        <StatTile
          label={t('dashboard.createdInPeriod')}
          value={data?.totals?.createdInPeriod}
          loading={isLoading}
        />
        <StatTile
          label={t('dashboard.completedInPeriod')}
          value={data?.totals?.completedInPeriod}
          loading={isLoading}
          tone="success"
        />
        <StatTile
          label={t('dashboard.unassigned')}
          value={data?.totals?.unassigned}
          loading={isLoading}
          tone={data?.totals?.unassigned > 0 ? 'warning' : undefined}
          to="/investigations?statusGroup=UNASSIGNED"
        />
        <StatTile
          label={t('dashboard.overdue')}
          value={data?.totals?.overdue}
          loading={isLoading}
          tone={data?.totals?.overdue > 0 ? 'danger' : undefined}
          to="/investigations?overdue=true"
        />
        <StatTile
          label={t('dashboard.activeInvestigators')}
          value={data?.totals?.activeInvestigators}
          loading={isLoading}
          to="/investigators"
        />
      </div>

      <div className="row g-3">
        {/* ── Volume over time ───────────────────────────────────────────── */}
        <div className="col-12 col-xl-8">
          <Panel title={t('dashboard.dailyVolume')}>
            {isLoading ? (
              <ChartSkeleton />
            ) : data?.dailyVolume?.length ? (
              <div style={{ height: 260 }}>
                <Line
                  options={{
                    ...chartOptions,
                    plugins: { ...chartOptions.plugins, legend: { display: true } },
                  }}
                  data={{
                    labels: data.dailyVolume.map((row) =>
                      new Date(row.day).toLocaleDateString(i18n.language, {
                        month: 'short',
                        day: 'numeric',
                      }),
                    ),
                    datasets: [
                      {
                        label: t('dashboard.created'),
                        data: data.dailyVolume.map((row) => row.created),
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37,99,235,.12)',
                        fill: true,
                        tension: 0.3,
                      },
                      {
                        label: t('dashboard.completedInPeriod'),
                        data: data.dailyVolume.map((row) => row.completed),
                        borderColor: '#16a34a',
                        backgroundColor: 'rgba(22,163,74,.12)',
                        fill: true,
                        tension: 0.3,
                      },
                    ],
                  }}
                />
              </div>
            ) : (
              <EmptyState title={t('dashboard.noData')} icon="graph-up" />
            )}
          </Panel>
        </div>

        {/* ── SLA ────────────────────────────────────────────────────────── */}
        <div className="col-12 col-xl-4">
          <Panel title={t('dashboard.slaCompliance')}>
            {isLoading ? (
              <ChartSkeleton height={150} />
            ) : data?.sla?.measured > 0 ? (
              <>
                <div className="text-center mb-3">
                  <div className="display-6 fw-semibold">
                    {data.sla.complianceRate}%
                  </div>
                  <div className="small text-body-secondary">
                    {t('dashboard.complianceRate')}
                  </div>
                </div>
                <div className="d-flex justify-content-around small">
                  <div className="text-center">
                    <div className="fw-semibold text-success">{data.sla.met}</div>
                    <div className="text-body-secondary">{t('dashboard.slaMet')}</div>
                  </div>
                  <div className="text-center">
                    <div className="fw-semibold text-danger">{data.sla.breached}</div>
                    <div className="text-body-secondary">
                      {t('dashboard.slaBreached')}
                    </div>
                  </div>
                </div>

                <hr />

                <div className="small">
                  <div className="fw-semibold mb-2">{t('dashboard.avgTat')}</div>
                  <TatRow
                    label={t('dashboard.tatAssignment')}
                    minutes={data.sla.averageTatMinutes?.assignment}
                  />
                  <TatRow
                    label={t('dashboard.tatAcceptance')}
                    minutes={data.sla.averageTatMinutes?.acceptance}
                  />
                  <TatRow
                    label={t('dashboard.tatField')}
                    minutes={data.sla.averageTatMinutes?.field}
                  />
                  <TatRow
                    label={t('dashboard.tatQc')}
                    minutes={data.sla.averageTatMinutes?.qc}
                  />
                  <TatRow
                    label={t('dashboard.tatTotal')}
                    minutes={data.sla.averageTatMinutes?.total}
                    strong
                  />
                </div>
              </>
            ) : (
              <EmptyState title={t('dashboard.noData')} icon="stopwatch" />
            )}
          </Panel>
        </div>

        {/* ── Status distribution ────────────────────────────────────────── */}
        <div className="col-12 col-lg-6">
          <Panel title={t('dashboard.byStatus')}>
            {isLoading ? (
              <ChartSkeleton />
            ) : (
              <div style={{ height: 240 }}>
                <Bar
                  options={{ ...chartOptions, indexAxis: 'y' }}
                  data={{
                    labels: Object.keys(data?.byGroup ?? {}).map((group) =>
                      t(`statusGroup.${group}`, group),
                    ),
                    datasets: [
                      {
                        data: Object.values(data?.byGroup ?? {}),
                        backgroundColor: '#2563eb',
                        borderRadius: 3,
                      },
                    ],
                  }}
                />
              </div>
            )}
          </Panel>
        </div>

        {/* ── QC ─────────────────────────────────────────────────────────── */}
        <div className="col-12 col-lg-6">
          <Panel title={t('nav.qualityControl')}>
            {isLoading ? (
              <ChartSkeleton />
            ) : data?.qc?.reviewed > 0 ? (
              <div className="row align-items-center">
                <div className="col-6">
                  <div style={{ height: 180 }}>
                    <Doughnut
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom' } },
                      }}
                      data={{
                        labels: [t('nav.approved'), t('nav.rejected')],
                        datasets: [
                          {
                            data: [data.qc.approved, data.qc.rejected],
                            backgroundColor: ['#16a34a', '#dc2626'],
                            borderWidth: 0,
                          },
                        ],
                      }}
                    />
                  </div>
                </div>
                <div className="col-6">
                  <div className="mb-3">
                    <div className="stat-card__label">
                      {t('dashboard.qcApprovalRate')}
                    </div>
                    <div className="stat-card__value text-success">
                      {data.qc.approvalRate}%
                    </div>
                  </div>
                  <div>
                    <div className="stat-card__label">
                      {t('dashboard.qcRejectionRate')}
                    </div>
                    <div className="stat-card__value text-danger">
                      {data.qc.rejectionRate}%
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState title={t('dashboard.noData')} icon="patch-check" />
            )}
          </Panel>
        </div>

        {/* ── Breakdowns ─────────────────────────────────────────────────── */}
        <BreakdownPanel
          title={t('dashboard.byType')}
          rows={data?.byInvestigationType}
          loading={isLoading}
          language={i18n.language}
        />
        <BreakdownPanel
          title={t('dashboard.byProduct')}
          rows={data?.byProduct}
          loading={isLoading}
          language={i18n.language}
        />
        <BreakdownPanel
          title={t('dashboard.byGovernorate')}
          rows={data?.byGovernorate}
          loading={isLoading}
          language={i18n.language}
        />
      </div>
    </>
  );
}

function StatTile({ label, value, loading, tone, to }) {
  const body = (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      {loading ? (
        <span className="placeholder col-6 d-block" style={{ height: '1.6rem' }} />
      ) : (
        <div className={`stat-card__value ${tone ? `text-${tone}` : ''}`}>
          {value ?? 0}
        </div>
      )}
    </div>
  );

  return (
    <div className="col-6 col-md-4 col-xl-2">
      {to ? (
        <Link to={to} className="text-decoration-none text-body d-block h-100">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

function TatRow({ label, minutes, strong }) {
  const readable =
    minutes == null
      ? '—'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;

  return (
    <div className="d-flex justify-content-between py-1">
      <span className="text-body-secondary">{label}</span>
      <span className={strong ? 'fw-semibold' : ''}>{readable}</span>
    </div>
  );
}

function BreakdownPanel({ title, rows, loading, language }) {
  const total = (rows ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="col-12 col-lg-4">
      <Panel title={title}>
        {loading ? (
          <ChartSkeleton height={140} />
        ) : rows?.length ? (
          <ul className="list-unstyled mb-0 small">
            {rows
              .slice()
              .sort((a, b) => b.count - a.count)
              .slice(0, 8)
              .map((row) => (
                <li key={row.id} className="mb-2">
                  <div className="d-flex justify-content-between">
                    <span className="truncate">{localisedName(row, language)}</span>
                    <span className="fw-semibold ms-2">{row.count}</span>
                  </div>
                  <div className="progress" style={{ height: 4 }}>
                    <div
                      className="progress-bar"
                      style={{
                        width: `${total > 0 ? (row.count / total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-body-secondary small mb-0">—</p>
        )}
      </Panel>
    </div>
  );
}

function ChartSkeleton({ height = 240 }) {
  return (
    <div
      className="placeholder w-100 rounded"
      style={{ height }}
      aria-busy="true"
    />
  );
}
