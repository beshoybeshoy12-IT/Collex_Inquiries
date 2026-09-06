import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { StateBadge } from '../../components/Badges';

/**
 * One import batch, after the fact.
 *
 * The staged rows survive the import, which is what makes this page useful
 * weeks later: "why is this case not in the system" is answerable by finding
 * the row and reading the reason it failed, rather than by re-running the file
 * and hoping.
 */
export default function ImportBatchDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState(false);

  const { data: batch, isLoading, error, refetch } = useQuery({
    queryKey: ['import-batch', id],
    queryFn: async () => (await api.get(`/imports/${id}`)).data,
    refetchInterval: (query) =>
      ['PARSING', 'PROCESSING', 'CONFIRMED'].includes(query.state.data?.status)
        ? 3000
        : false,
  });

  const { data: rows } = useQuery({
    queryKey: ['import-rows', id, status, page],
    queryFn: async () =>
      (
        await api.get(`/imports/${id}/rows`, {
          params: { status: status || undefined, page, limit: 25 },
        })
      ).data,
  });

  const cancel = useMutation({
    mutationFn: async () => (await api.post(`/imports/${id}/cancel`)).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setCancelling(false);
      queryClient.invalidateQueries({ queryKey: ['import-batch', id] });
      queryClient.invalidateQueries({ queryKey: ['import-batches'] });
    },
    onError: (mutationError) => {
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
      setCancelling(false);
    },
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-4 d-block mb-3" style={{ height: 32 }} />
        <span className="placeholder col-12 d-block" style={{ height: 260 }} />
      </div>
    );
  }

  const cancellable = !['COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED'].includes(
    batch.status,
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/imports" className="small text-decoration-none">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            {t('imports.history')}
          </Link>
        }
        title={
          <span className="d-flex align-items-center gap-2 flex-wrap">
            <span className="mono">{batch.reference}</span>
            <StateBadge value={batch.status} namespace="importStatus" />
          </span>
        }
        subtitle={batch.fileName}
        actions={
          <>
            {batch.invalidRows > 0 && (
              <a
                className="btn btn-sm btn-outline-secondary"
                href={`/api/v1/imports/${id}/error-report`}
              >
                <i className="bi bi-download me-1" aria-hidden="true" />
                {t('imports.downloadErrors')}
              </a>
            )}
            {batch.importedRows > 0 && (
              <Link
                to={`/investigations?importBatchId=${id}`}
                className="btn btn-sm btn-outline-primary"
              >
                {t('cases.title')} ({batch.importedRows})
              </Link>
            )}
            {cancellable && can(P.IMPORTS_CANCEL) && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => setCancelling(true)}
              >
                {t('imports.cancelBatch')}
              </button>
            )}
          </>
        }
      />

      <div className="row g-3 mb-3">
        <Tile label={t('imports.totalRows')} value={batch.totalRows} />
        <Tile label={t('imports.validRows')} value={batch.validRows} tone="success" />
        <Tile
          label={t('imports.duplicateRows')}
          value={batch.duplicateRows}
          tone="warning"
        />
        <Tile label={t('imports.invalidRows')} value={batch.invalidRows} tone="danger" />
        <Tile
          label={t('imports.imported', { count: '' }).trim()}
          value={batch.importedRows}
          tone="success"
        />
        <Tile label={t('imports.importFailed', { count: '' }).trim()} value={batch.failedRows} tone="danger" />
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-4">
          <Panel title={t('common.details')}>
            <Field label={t('imports.uploadedBy')}>{batch.uploadedBy?.fullName}</Field>
            <Field label={t('imports.uploadedAt')}>
              {new Date(batch.uploadedAt).toLocaleString(i18n.language)}
            </Field>
            {batch.confirmedAt && (
              <Field label={t('importStatus.CONFIRMED')}>
                {new Date(batch.confirmedAt).toLocaleString(i18n.language)}
              </Field>
            )}
            {batch.completedAt && (
              <Field label={t('importStatus.COMPLETED')}>
                {new Date(batch.completedAt).toLocaleString(i18n.language)}
              </Field>
            )}
            <Field label={t('imports.sheet')}>{batch.sheetName}</Field>
          </Panel>

          {batch.errorSummary?.topErrors?.length > 0 && (
            <Panel title={t('imports.topErrors')} className="mt-3">
              <ul className="list-unstyled mb-0 small">
                {batch.errorSummary.topErrors.map((entry, index) => (
                  <li key={index} className="d-flex justify-content-between py-1">
                    <span>
                      <span className="badge text-bg-light me-1">{entry.column}</span>
                      {entry.reason}
                    </span>
                    <span className="fw-semibold">{entry.count}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="col-12 col-lg-8">
          <Panel
            title={t('imports.steps.preview')}
            actions={
              <select
                className="form-select form-select-sm"
                style={{ width: 'auto' }}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t('common.all')}</option>
                {['VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED', 'FAILED'].map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`importRowStatus.${value}`)}
                    </option>
                  ),
                )}
              </select>
            }
            bodyClassName="p-0"
          >
            <div className="table-responsive" style={{ maxHeight: 480 }}>
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>{t('imports.row')}</th>
                    <th style={{ width: 110 }}>{t('common.status')}</th>
                    <th>{t('customers.customer')}</th>
                    <th>{t('imports.problems')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows?.data ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.rowNumber}</td>
                      <td>
                        <StateBadge value={row.status} namespace="importRowStatus" />
                      </td>
                      <td className="small">
                        {row.createdInvestigationId ? (
                          <Link
                            to={`/investigations/${row.createdInvestigationId}`}
                            className="text-decoration-none"
                          >
                            {row.mappedData?.fullName ?? '—'}
                          </Link>
                        ) : (
                          (row.mappedData?.fullName ?? '—')
                        )}
                        {row.mappedData?.nationalId && (
                          <span className="mono text-body-secondary ms-2">
                            {row.mappedData.nationalId}
                          </span>
                        )}
                      </td>
                      <td className="small">
                        {(row.errors ?? []).map((problem, index) => (
                          <div key={index} className="text-danger">
                            <span className="badge text-bg-light me-1">
                              {problem.column ?? problem.field}
                            </span>
                            {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                          </div>
                        ))}
                        {(row.warnings ?? []).map((problem, index) => (
                          <div key={`w${index}`} className="text-warning-emphasis">
                            <span className="badge text-bg-light me-1">
                              {problem.column ?? problem.field}
                            </span>
                            {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows?.meta && rows.meta.totalPages > 1 && (
              <div className="d-flex justify-content-between align-items-center p-2 small border-top">
                <span className="text-body-secondary">
                  {t('common.showing', {
                    from: (rows.meta.page - 1) * rows.meta.limit + 1,
                    to: Math.min(rows.meta.page * rows.meta.limit, rows.meta.total),
                    total: rows.meta.total,
                  })}
                </span>
                <div className="btn-group btn-group-sm">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    disabled={!rows.meta.hasPrev}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    disabled={!rows.meta.hasNext}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() => cancel.mutate()}
        title={t('imports.cancelBatch')}
        message={batch.reference}
        busy={cancel.isPending}
      />
    </>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className="col-6 col-md-4 col-xl-2">
      <div className="stat-card">
        <div className="stat-card__label">{label}</div>
        <div className={`stat-card__value ${tone ? `text-${tone}` : ''}`}>
          {value ?? 0}
        </div>
      </div>
    </div>
  );
}
