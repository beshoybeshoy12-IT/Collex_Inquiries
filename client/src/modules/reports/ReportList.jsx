import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import { useToast } from '../../components/Toast';
import { StatusBadge } from '../../components/Badges';

/**
 * Completed work, and the reports produced from it.
 *
 * This is a view over investigations rather than over the `reports` table,
 * because that is the question people actually ask: "which finished cases have
 * a report, and which are still waiting". A list of report rows would hide the
 * approved case nobody has generated anything for yet.
 */
export default function ReportList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['completed-cases', page, search],
    queryFn: async () =>
      (
        await api.get('/investigations', {
          params: {
            statusGroup: 'COMPLETED',
            page,
            limit: 25,
            search: search || undefined,
            sortBy: 'completedAt',
            sortOrder: 'desc',
          },
        })
      ).data,
  });

  const download = async (investigationId) => {
    try {
      const { data: reports } = await api.get(
        `/reports/investigation/${investigationId}`,
      );
      const ready = reports.find((report) => report.status === 'READY');
      if (!ready) {
        toast.info(t('reports.noReports'));
        return;
      }
      const { data: link } = await api.get(`/reports/${ready.id}/download`);
      if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (downloadError) {
      toast.error(downloadError);
    }
  };

  const columns = [
    {
      key: 'caseNumber',
      header: t('cases.caseNumber'),
      render: (row) => (
        <Link
          to={`/investigations/${row.id}?tab=report`}
          className="mono fw-semibold text-decoration-none"
        >
          {row.caseNumber}
        </Link>
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
      key: 'status',
      header: t('common.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'result',
      header: t('cases.result'),
      render: (row) =>
        row.result ? (
          <span
            className={`badge text-bg-${
              row.result === 'POSITIVE'
                ? 'success'
                : row.result === 'NEGATIVE'
                  ? 'danger'
                  : 'warning'
            }`}
          >
            {t(`result.${row.result}`)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'completedAt',
      header: t('status.COMPLETED'),
      sortable: true,
      render: (row) => (
        <span className="small text-nowrap">
          {row.completedAt
            ? new Date(row.completedAt).toLocaleDateString(i18n.language)
            : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        can(P.REPORTS_DOWNLOAD) && (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary py-0"
            onClick={(event) => {
              event.stopPropagation();
              download(row.id);
            }}
          >
            <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
            PDF
          </button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
      />

      <div className="card mb-3">
        <div className="card-body py-2">
          <input
            type="search"
            className="form-control form-control-sm"
            style={{ maxWidth: 380 }}
            placeholder={t('cases.searchPlaceholder')}
            defaultValue={search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setSearch(event.target.value.trim());
                setPage(1);
              }
            }}
          />
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
            onPageChange={setPage}
            onRowClick={(row) => navigate(`/investigations/${row.id}?tab=report`)}
            emptyTitle={t('reports.noReports')}
          />
        </div>
      </div>
    </>
  );
}
