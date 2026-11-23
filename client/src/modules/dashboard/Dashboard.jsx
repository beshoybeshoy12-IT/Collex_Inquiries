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
import { useAuth } from '../../app/AuthContext';
import { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import useChartTheme from '../../hooks/useChartTheme';

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

const PERIODS = [7, 30, 90];

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
 *
 * LAYOUT, top to bottom, in the order a coordinator's questions come: what
 * needs me now (the KPI row, with the alarming ones coloured only when they
 * are non-zero), how we are doing against the promise (SLA ring, volume),
 * where the work is (status, QC), and what it is made of (breakdowns).
 * Colour carries meaning only — a tile is red because something is late, not
 * for decoration — and every colour is a theme token, so dark mode follows.
 */
export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [period, setPeriod] = useState(30);
  const chart = useChartTheme();

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

  const rtl = i18n.language === 'ar';
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { rtl, padding: 10, cornerRadius: 8, boxPadding: 4 },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
        border: { display: false },
      },
    },
  };

  const hour = new Date().getHours();
  const firstName = (user?.fullName ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
  const today = new Date().toLocaleDateString(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const totals = data?.totals ?? {};

  return (
    <>
      {/* ── Greeting and period ─────────────────────────────────────────── */}
      <div className="dash-hero mb-4">
        <div className="min-vw-0">
          <div className="text-body-secondary small mb-1">
            <i className="bi bi-calendar3 me-1" aria-hidden="true" />
            {today}
          </div>
          <h1 className="h3 fw-bold mb-1">
            {firstName
              ? t(hour < 12 ? 'dashboard.greetMorningName' : 'dashboard.greetEveningName', {
                  name: firstName,
                })
              : t(hour < 12 ? 'dashboard.greetMorning' : 'dashboard.greetEvening')}
          </h1>
          <p className="text-body-secondary mb-0">{t('dashboard.subtitle')}</p>
        </div>

        <div className="segmented" role="group" aria-label={t('dashboard.period')}>
          {PERIODS.map((days) => (
            <button
              key={days}
              type="button"
              className={period === days ? 'active' : ''}
              aria-pressed={period === days}
              onClick={() => setPeriod(days)}
            >
              {t('dashboard.lastDays', { count: days })}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="row g-3 mb-4">
        <Kpi
          icon="folder2-open"
          tone="primary"
          label={t('dashboard.totalCases')}
          value={totals.all}
          loading={isLoading}
          to="/investigations"
        />
        <Kpi
          icon="plus-circle"
          tone="info"
          label={t('dashboard.createdInPeriod')}
          value={totals.createdInPeriod}
          loading={isLoading}
        />
        <Kpi
          icon="check2-circle"
          tone="success"
          label={t('dashboard.completedInPeriod')}
          value={totals.completedInPeriod}
          loading={isLoading}
        />
        <Kpi
          icon="inbox"
          tone={totals.unassigned > 0 ? 'warning' : 'secondary'}
          label={t('dashboard.unassigned')}
          value={totals.unassigned}
          loading={isLoading}
          to="/investigations?statusGroup=UNASSIGNED"
          alert={totals.unassigned > 0}
        />
        <Kpi
          icon="alarm"
          tone={totals.overdue > 0 ? 'danger' : 'secondary'}
          label={t('dashboard.overdue')}
          value={totals.overdue}
          loading={isLoading}
          to="/investigations?overdue=true"
          alert={totals.overdue > 0}
        />
        <Kpi
          icon="person-badge"
          tone="primary"
          label={t('dashboard.activeInvestigators')}
          value={totals.activeInvestigators}
          loading={isLoading}
          to="/investigators"
        />
      </div>

      <div className="row g-3">
        {/* ── Volume over time ───────────────────────────────────────────── */}
        <div className="col-12 col-xl-8">
          <Panel title={<PanelTitle icon="graph-up-arrow" text={t('dashboard.dailyVolume')} />}>
            {isLoading ? (
              <ChartSkeleton />
            ) : data?.dailyVolume?.length ? (
              <div style={{ height: 280 }}>
                <Line
                  key={chart.theme}
                  options={{
                    ...chartOptions,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                      ...chartOptions.plugins,
                      legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        rtl,
                        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8 },
                      },
                    },
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
                        borderColor: chart.series[0],
                        backgroundColor: chart.alpha(chart.series[0], 0.1),
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                      },
                      {
                        label: t('dashboard.completedInPeriod'),
                        data: data.dailyVolume.map((row) => row.completed),
                        borderColor: chart.series[1],
                        backgroundColor: chart.alpha(chart.series[1], 0.08),
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
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
          <Panel
            className="h-100"
            title={<PanelTitle icon="stopwatch" text={t('dashboard.slaCompliance')} />}
          >
            {isLoading ? (
              <ChartSkeleton height={150} />
            ) : data?.sla?.measured > 0 ? (
              <>
                <div className="d-flex align-items-center gap-3 mb-3">
                  <Ring value={data.sla.complianceRate} label={t('dashboard.complianceRate')} />
                  <div className="flex-grow-1 d-flex flex-column gap-2">
                    <LegendStat tone="success" label={t('dashboard.slaMet')} value={data.sla.met} />
                    <LegendStat
                      tone="danger"
                      label={t('dashboard.slaBreached')}
                      value={data.sla.breached}
                    />
                  </div>
                </div>

                <div className="dash-subtitle">
                  <i className="bi bi-clock-history me-1" aria-hidden="true" />
                  {t('dashboard.avgTat')}
                </div>
                <TatRow icon="person-plus" label={t('dashboard.tatAssignment')} minutes={data.sla.averageTatMinutes?.assignment} />
                <TatRow icon="hand-thumbs-up" label={t('dashboard.tatAcceptance')} minutes={data.sla.averageTatMinutes?.acceptance} />
                <TatRow icon="geo-alt" label={t('dashboard.tatField')} minutes={data.sla.averageTatMinutes?.field} />
                <TatRow icon="patch-check" label={t('dashboard.tatQc')} minutes={data.sla.averageTatMinutes?.qc} />
                <TatRow icon="flag" label={t('dashboard.tatTotal')} minutes={data.sla.averageTatMinutes?.total} strong />
              </>
            ) : (
              <EmptyState title={t('dashboard.noData')} icon="stopwatch" />
            )}
          </Panel>
        </div>

        {/* ── Status distribution ────────────────────────────────────────── */}
        <div className="col-12 col-lg-7">
          <Panel
            className="h-100"
            title={<PanelTitle icon="bar-chart-steps" text={t('dashboard.byStatus')} />}
          >
            {isLoading ? (
              <ChartSkeleton />
            ) : (
              <div style={{ height: 260 }}>
                <Bar
                  key={chart.theme}
                  options={{
                    ...chartOptions,
                    indexAxis: 'y',
                    scales: {
                      x: { beginAtZero: true, ticks: { precision: 0 }, border: { display: false } },
                      y: { grid: { display: false }, border: { display: false }, position: rtl ? 'right' : 'left' },
                    },
                  }}
                  data={{
                    labels: Object.keys(data?.byGroup ?? {}).map((group) =>
                      t(`statusGroup.${group}`, group),
                    ),
                    datasets: [
                      {
                        data: Object.values(data?.byGroup ?? {}),
                        backgroundColor: Object.keys(data?.byGroup ?? {}).map((_, index) =>
                          chart.alpha(chart.series[index % chart.series.length], 0.85),
                        ),
                        borderRadius: 6,
                        barThickness: 14,
                      },
                    ],
                  }}
                />
              </div>
            )}
          </Panel>
        </div>

        {/* ── QC ─────────────────────────────────────────────────────────── */}
        <div className="col-12 col-lg-5">
          <Panel
            className="h-100"
            title={<PanelTitle icon="patch-check" text={t('nav.qualityControl')} />}
          >
            {isLoading ? (
              <ChartSkeleton />
            ) : data?.qc?.reviewed > 0 ? (
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <div className="position-relative" style={{ width: 170, height: 170 }}>
                  <Doughnut
                    key={chart.theme}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: '74%',
                      plugins: { legend: { display: false }, tooltip: { rtl } },
                    }}
                    data={{
                      labels: [t('nav.approved'), t('nav.rejected')],
                      datasets: [
                        {
                          data: [data.qc.approved, data.qc.rejected],
                          backgroundColor: [chart.series[1], chart.series[2]],
                          borderWidth: 0,
                          spacing: 2,
                        },
                      ],
                    }}
                  />
                  <div className="doughnut-center">
                    <div className="fs-4 fw-bold">{data.qc.reviewed}</div>
                    <div className="small text-body-secondary">{t('qc.reviewed')}</div>
                  </div>
                </div>
                <div className="flex-grow-1 d-flex flex-column gap-2">
                  <LegendStat tone="success" label={t('dashboard.qcApprovalRate')} value={`${data.qc.approvalRate}%`} />
                  <LegendStat tone="danger" label={t('dashboard.qcRejectionRate')} value={`${data.qc.rejectionRate}%`} />
                </div>
              </div>
            ) : (
              <EmptyState title={t('dashboard.noData')} icon="patch-check" />
            )}
          </Panel>
        </div>

        {/* ── Breakdowns ─────────────────────────────────────────────────── */}
        <BreakdownPanel
          icon="tags"
          title={t('dashboard.byType')}
          rows={data?.byInvestigationType}
          loading={isLoading}
          language={i18n.language}
          tone="primary"
        />
        <BreakdownPanel
          icon="box-seam"
          title={t('dashboard.byProduct')}
          rows={data?.byProduct}
          loading={isLoading}
          language={i18n.language}
          tone="info"
        />
        <BreakdownPanel
          icon="geo"
          title={t('dashboard.byGovernorate')}
          rows={data?.byGovernorate}
          loading={isLoading}
          language={i18n.language}
          tone="success"
        />
      </div>
    </>
  );
}

function PanelTitle({ icon, text }) {
  return (
    <span className="d-inline-flex align-items-center gap-2">
      <span className="panel-icon" aria-hidden="true">
        <i className={`bi bi-${icon}`} />
      </span>
      {text}
    </span>
  );
}

/**
 * One headline figure. `alert` marks a non-zero count of something that is a
 * problem (late, unassigned): the tile gets a coloured edge so it is found by
 * scanning, not by reading.
 */
function Kpi({ icon, tone, label, value, loading, to, alert }) {
  const body = (
    <div className={`kpi-card ${alert ? `kpi-alert kpi-alert-${tone}` : ''}`}>
      <div className="d-flex align-items-start justify-content-between gap-2">
        <span className={`kpi-icon bg-${tone}-subtle text-${tone}-emphasis`} aria-hidden="true">
          <i className={`bi bi-${icon}`} />
        </span>
        {to && <i className="bi bi-arrow-up-right kpi-go" aria-hidden="true" />}
      </div>
      {loading ? (
        <span className="placeholder col-6 d-block mt-3" style={{ height: '1.8rem' }} />
      ) : (
        <div className="kpi-value">{value ?? 0}</div>
      )}
      <div className="kpi-label">{label}</div>
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

/** A percentage as a ring. Green from 90%, amber from 75%, red below. */
function Ring({ value, label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = pct >= 90 ? 'success' : pct >= 75 ? 'warning' : 'danger';
  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="ring" role="img" aria-label={`${label}: ${pct}%`}>
      <svg viewBox="0 0 110 110" width="116" height="116">
        <circle cx="55" cy="55" r={radius} className="ring-track" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          className="ring-value"
          style={{
            stroke: `var(--bs-${tone})`,
            strokeDasharray: `${(pct / 100) * circumference} ${circumference}`,
          }}
        />
      </svg>
      <div className="ring-center">
        <div className="fs-4 fw-bold lh-1">{pct}%</div>
        <div className="text-body-secondary" style={{ fontSize: '.7rem' }}>
          {label}
        </div>
      </div>
    </div>
  );
}

function LegendStat({ tone, label, value }) {
  return (
    <div className="legend-stat">
      <span className={`legend-dot bg-${tone}`} aria-hidden="true" />
      <span className="text-body-secondary small flex-grow-1">{label}</span>
      <span className="fw-bold">{value}</span>
    </div>
  );
}

function TatRow({ icon, label, minutes, strong }) {
  const readable =
    minutes == null
      ? '—'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;

  return (
    <div className={`tat-row ${strong ? 'tat-total' : ''}`}>
      <i className={`bi bi-${icon}`} aria-hidden="true" />
      <span className="flex-grow-1 text-body-secondary">{label}</span>
      <span className={`mono ${strong ? 'fw-bold' : 'fw-semibold'}`}>{readable}</span>
    </div>
  );
}

function BreakdownPanel({ icon, title, rows, loading, language, tone }) {
  const total = (rows ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="col-12 col-lg-4">
      <Panel className="h-100" title={<PanelTitle icon={icon} text={title} />}>
        {loading ? (
          <ChartSkeleton height={140} />
        ) : rows?.length ? (
          <ul className="list-unstyled mb-0 small d-flex flex-column gap-3">
            {rows
              .slice()
              .sort((a, b) => b.count - a.count)
              .slice(0, 8)
              .map((row) => {
                const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
                return (
                  <li key={row.id}>
                    <div className="d-flex justify-content-between align-items-baseline mb-1 gap-2">
                      <span className="truncate fw-medium">{localisedName(row, language)}</span>
                      <span className="text-nowrap">
                        <span className="fw-bold">{row.count}</span>
                        <span className="text-body-tertiary ms-1">{share}%</span>
                      </span>
                    </div>
                    <div className="progress" style={{ height: 6 }}>
                      <div className={`progress-bar bg-${tone}`} style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
          </ul>
        ) : (
          <EmptyState title="—" icon={icon} />
        )}
      </Panel>
    </div>
  );
}

function ChartSkeleton({ height = 240 }) {
  return (
    <div className="placeholder-glow" aria-busy="true">
      <div className="placeholder w-100 rounded-3" style={{ height }} />
    </div>
  );
}
