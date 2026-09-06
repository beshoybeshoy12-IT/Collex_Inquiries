import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';

const CATEGORIES = [
  'AUTH',
  'USER',
  'ROLE',
  'INVESTIGATOR',
  'CUSTOMER',
  'INVESTIGATION',
  'ASSIGNMENT',
  'IMPORT',
  'FORM',
  'MEDIA',
  'QC',
  'REPORT',
  'EXPORT',
  'SETTINGS',
  'TENANT',
  'SECURITY',
];

/**
 * The audit trail.
 *
 * READ-ONLY, and there is no endpoint that would make it anything else. Rows
 * leave this table through a dated retention sweep and no other way, which is
 * the property that makes it worth keeping at all.
 */
export default function AuditLog() {
  const { t, i18n } = useTranslation();

  const [filters, setFilters] = useState({ page: 1 });
  const [detail, setDetail] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit', filters],
    queryFn: async () =>
      (await api.get('/audit', { params: { ...filters, limit: 25 } })).data,
  });

  const setFilter = (key, value) =>
    setFilters((current) => ({
      ...current,
      [key]: value || undefined,
      ...(key === 'page' ? {} : { page: 1 }),
    }));

  const columns = [
    {
      key: 'createdAt',
      header: t('common.createdAt'),
      sortable: true,
      render: (row) => (
        <span className="small text-nowrap">
          {new Date(row.createdAt).toLocaleString(i18n.language)}
        </span>
      ),
    },
    {
      key: 'action',
      header: t('audit.action'),
      render: (row) => (
        <span>
          <span className="mono small">{row.action}</span>
          {row.severity !== 'INFO' && (
            <span
              className={`badge ms-2 text-bg-${
                row.severity === 'CRITICAL'
                  ? 'danger'
                  : row.severity === 'WARNING'
                    ? 'warning'
                    : 'info'
              }`}
            >
              {row.severity}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('audit.category'),
      render: (row) => <span className="badge text-bg-light">{row.category}</span>,
    },
    {
      key: 'actorName',
      header: t('audit.actor'),
      render: (row) => row.actorName ?? 'system',
    },
    {
      key: 'entity',
      header: t('audit.entity'),
      render: (row) =>
        row.entityType ? (
          <span className="small">
            {row.entityType}
            {row.entityLabel && (
              <span className="mono text-body-secondary ms-1">{row.entityLabel}</span>
            )}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'ip',
      header: t('audit.ip'),
      render: (row) => <span className="mono small">{row.ip ?? '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
      />

      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2">
            <div className="col-12 col-md-3">
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder={t('common.search')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setFilter('search', event.target.value.trim());
                }}
              />
            </div>
            <div className="col-6 col-md-2">
              <select
                className="form-select form-select-sm"
                value={filters.category ?? ''}
                onChange={(event) => setFilter('category', event.target.value)}
              >
                <option value="">{t('audit.category')}</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <input
                type="date"
                className="form-control form-control-sm"
                value={filters.from?.slice(0, 10) ?? ''}
                onChange={(event) =>
                  setFilter(
                    'from',
                    event.target.value ? new Date(event.target.value).toISOString() : '',
                  )
                }
              />
            </div>
            <div className="col-6 col-md-2">
              <input
                type="date"
                className="form-control form-control-sm"
                value={filters.to?.slice(0, 10) ?? ''}
                onChange={(event) =>
                  setFilter(
                    'to',
                    event.target.value ? new Date(event.target.value).toISOString() : '',
                  )
                }
              />
            </div>
            <div className="col-6 col-md-3 d-flex align-items-center">
              <button
                type="button"
                className="btn btn-sm btn-link text-decoration-none p-0"
                onClick={() => setFilters({ page: 1 })}
              >
                {t('common.clearFilters')}
              </button>
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
            onPageChange={(page) => setFilter('page', page)}
            onRowClick={setDetail}
            emptyTitle={t('audit.noEntries')}
            compact
          />
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="modal-lg"
        title={detail?.action}
      >
        {detail && (
          <>
            <dl className="row small mb-3">
              <dt className="col-4 text-body-secondary">{t('common.createdAt')}</dt>
              <dd className="col-8">
                {new Date(detail.createdAt).toLocaleString(i18n.language)}
              </dd>

              <dt className="col-4 text-body-secondary">{t('audit.actor')}</dt>
              <dd className="col-8">
                {detail.actorName ?? 'system'}
                {detail.actorType && (
                  <span className="badge text-bg-light ms-2">{detail.actorType}</span>
                )}
              </dd>

              <dt className="col-4 text-body-secondary">{t('audit.entity')}</dt>
              <dd className="col-8">
                {detail.entityType} <span className="mono">{detail.entityId}</span>
              </dd>

              <dt className="col-4 text-body-secondary">{t('audit.ip')}</dt>
              <dd className="col-8 mono">{detail.ip ?? '—'}</dd>

              {detail.requestId && (
                <>
                  <dt className="col-4 text-body-secondary">Request</dt>
                  <dd className="col-8 mono">{detail.requestId}</dd>
                </>
              )}
            </dl>

            {detail.newValue && Object.keys(detail.newValue).length > 0 && (
              <>
                <h3 className="h6">{t('audit.changes')}</h3>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th />
                      <th>{t('audit.before')}</th>
                      <th>{t('audit.after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(detail.newValue).map(([key, value]) => (
                      <tr key={key}>
                        <td className="text-body-secondary">{key}</td>
                        <td className="text-body-tertiary">
                          {stringify(detail.oldValue?.[key])}
                        </td>
                        <td className="fw-medium">{stringify(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {detail.metadata && Object.keys(detail.metadata).length > 0 && (
              <>
                <h3 className="h6">{t('common.details')}</h3>
                <pre className="small bg-body-tertiary p-2 rounded" dir="ltr">
                  {JSON.stringify(detail.metadata, null, 2)}
                </pre>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

function stringify(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
