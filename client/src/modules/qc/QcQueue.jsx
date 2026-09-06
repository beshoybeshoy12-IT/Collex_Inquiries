import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import { useInvestigationTypes } from '../../hooks/useCatalog';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import { PriorityBadge, SlaBadge } from '../../components/Badges';

/**
 * The QC review queue.
 *
 * ORDERED OLDEST-SUBMITTED FIRST, so working from the top is working the case
 * that has waited longest. Sorting by anything else by default quietly lets old
 * cases age out of sight while newer ones get reviewed, which is precisely what
 * the QC leg of the SLA is meant to prevent.
 *
 * The rework count is on the row because a case coming back for the third time
 * is a different conversation from one arriving for the first.
 */
export default function QcQueue() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { data: types } = useInvestigationTypes();

  const query = Object.fromEntries(params.entries());
  const page = Number(query.page ?? 1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['qc-queue', query],
    queryFn: async () =>
      (
        await api.get('/qc/queue', {
          params: { ...query, page, limit: 25, sortOrder: query.sortOrder ?? 'asc' },
        })
      ).data,
    refetchInterval: 60_000,
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const columns = [
    {
      key: 'caseNumber',
      header: t('cases.caseNumber'),
      render: (row) => (
        <div>
          <span className="mono fw-semibold">{row.caseNumber}</span>
          {row.reworkCount > 0 && (
            <span className="badge text-bg-warning ms-2">
              {t('nav.rework')} ×{row.reworkCount}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      header: t('cases.customer'),
      render: (row) => row.customer?.fullName ?? '—',
    },
    {
      key: 'investigationType',
      header: t('cases.investigationType'),
      render: (row) => localisedName(row.investigationType, i18n.language),
    },
    {
      key: 'investigator',
      header: t('cases.investigator'),
      render: (row) => row.investigator?.fullName ?? '—',
    },
    {
      key: 'evidence',
      header: t('media.evidence'),
      render: (row) => (
        <span className="badge text-bg-light">
          <i className="bi bi-camera me-1" aria-hidden="true" />
          {row._count?.mediaAssets ?? 0}
        </span>
      ),
    },
    {
      key: 'priority',
      header: t('cases.priority'),
      sortable: true,
      render: (row) => <PriorityBadge priority={row.priority} />,
    },
    {
      key: 'submittedAt',
      header: t('status.SUBMITTED'),
      sortable: true,
      render: (row) => (
        <span className="small">
          {row.submittedAt
            ? new Date(row.submittedAt).toLocaleString(i18n.language)
            : '—'}
        </span>
      ),
    },
    {
      key: 'dueAt',
      header: t('cases.sla'),
      sortable: true,
      render: (row) => <SlaBadge sla={row.sla} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('qc.queue')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
      />

      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2">
            <div className="col-12 col-md-4">
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder={t('common.search')}
                defaultValue={query.search ?? ''}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setFilter('search', event.target.value.trim());
                }}
              />
            </div>
            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={query.investigationTypeId ?? ''}
                onChange={(event) => setFilter('investigationTypeId', event.target.value)}
              >
                <option value="">{t('cases.investigationType')}</option>
                {(types ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {localisedName(type, i18n.language)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={query.status ?? ''}
                onChange={(event) => setFilter('status', event.target.value)}
              >
                <option value="">{t('status.QC_PENDING')}</option>
                <option value="QC_APPROVED">{t('status.QC_APPROVED')}</option>
                <option value="QC_REJECTED">{t('status.QC_REJECTED')}</option>
                <option value="REWORK">{t('status.REWORK')}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <DataTable
            columns={columns}
            rows={data?.data}
            meta={data?.meta}
            loading={isLoading}
            error={error}
            onRetry={refetch}
            onPageChange={(next) => setFilter('page', next)}
            onSort={(key, order) => {
              const next = new URLSearchParams(params);
              next.set('sortBy', key);
              next.set('sortOrder', order);
              setParams(next, { replace: true });
            }}
            sortBy={query.sortBy ?? 'submittedAt'}
            sortOrder={query.sortOrder ?? 'asc'}
            onRowClick={(row) => navigate(`/qc/${row.id}`)}
            emptyTitle={t('qc.noPending')}
          />
        </div>
      </div>
    </>
  );
}
