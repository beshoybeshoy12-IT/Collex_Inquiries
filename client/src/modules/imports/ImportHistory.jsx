import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import { StateBadge } from '../../components/Badges';

export default function ImportHistory() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['import-batches', page],
    queryFn: async () =>
      (await api.get('/imports', { params: { page, limit: 25 } })).data,
    // A batch confirmed in another tab moves through PROCESSING; a slow poll
    // keeps this list honest without hammering the endpoint.
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some((batch) =>
        ['PARSING', 'PROCESSING', 'CONFIRMED'].includes(batch.status),
      )
        ? 4000
        : false,
  });

  const columns = [
    {
      key: 'reference',
      header: t('imports.reference'),
      render: (row) => (
        <Link to={`/imports/${row.id}`} className="mono fw-semibold text-decoration-none">
          {row.reference}
        </Link>
      ),
    },
    {
      key: 'fileName',
      header: t('imports.fileName'),
      render: (row) => <span className="truncate d-block">{row.fileName}</span>,
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <StateBadge value={row.status} namespace="importStatus" />,
    },
    {
      key: 'rows',
      header: t('imports.totalRows'),
      render: (row) => (
        <div className="small">
          <span className="text-success">{row.importedRows}</span>
          {' / '}
          <span>{row.totalRows}</span>
          {row.invalidRows > 0 && (
            <span className="text-danger ms-2">
              {row.invalidRows} {t('imports.invalidRows').toLowerCase()}
            </span>
          )}
          {row.duplicateRows > 0 && (
            <span className="text-warning-emphasis ms-2">
              {row.duplicateRows} {t('imports.duplicateRows').toLowerCase()}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'uploadedBy',
      header: t('imports.uploadedBy'),
      render: (row) => row.uploadedBy?.fullName ?? '—',
    },
    {
      key: 'uploadedAt',
      header: t('imports.uploadedAt'),
      sortable: true,
      render: (row) => (
        <span className="small text-nowrap">
          {new Date(row.uploadedAt).toLocaleString(i18n.language)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('imports.history')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
        actions={
          can(P.IMPORTS_CREATE) && (
            <Link to="/imports/new" className="btn btn-sm btn-primary">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('imports.newImport')}
            </Link>
          )
        }
      />

      <div className="card">
        <div className="card-body">
          <DataTable
            columns={columns}
            rows={data?.data}
            meta={data?.meta}
            loading={isLoading}
            error={error}
            onRetry={refetch}
            onPageChange={setPage}
            onRowClick={(row) => navigate(`/imports/${row.id}`)}
            emptyTitle={t('imports.noBatches')}
          />
        </div>
      </div>
    </>
  );
}
