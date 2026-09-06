import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { StateBadge } from '../../components/Badges';

/**
 * Report versions for a case.
 *
 * GENERATION IS ASYNCHRONOUS AND THE UI SAYS SO. The request returns a QUEUED
 * row; this list polls while anything is still generating and stops as soon as
 * nothing is. Pretending a 40-second Chromium render is instant would mean
 * either a spinner that outlives the request timeout, or a download button that
 * 400s.
 *
 * Regenerating creates a new version beside the old one — never over it. A
 * delivered report is a document somebody has acted on.
 */
export default function CaseReports({ investigation }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [generating, setGenerating] = useState(false);
  const [locale, setLocale] = useState('AR');
  const [isFinal, setIsFinal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['reports', investigation.id],
    queryFn: async () =>
      (await api.get(`/reports/investigation/${investigation.id}`)).data,
    // Poll only while something is in flight, then stop. A fixed interval
    // would keep a query per open tab running against a table that has not
    // changed since yesterday.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((report) =>
        ['QUEUED', 'GENERATING'].includes(report.status),
      )
        ? 3000
        : false,
  });

  const generate = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/reports/investigation/${investigation.id}/generate`, {
          locale,
          isFinal,
        })
      ).data,
    onSuccess: (result) => {
      toast.success(result.queued ? t('reports.queued') : t('reports.ready'));
      setGenerating(false);
      queryClient.invalidateQueries({ queryKey: ['reports', investigation.id] });
      queryClient.invalidateQueries({ queryKey: ['investigation', investigation.id] });
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const download = async (reportId) => {
    try {
      const { data: link } = await api.get(`/reports/${reportId}/download`);
      if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error);
    }
  };

  const reports = data ?? [];

  // The server refuses a report before QC has signed off; offering the button
  // anyway would just produce a 400 the user cannot act on.
  const reportable = [
    'QC_APPROVED',
    'REPORT_GENERATION',
    'COMPLETED',
    'ARCHIVED',
  ].includes(investigation.status);

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h6 mb-0">{t('reports.title')}</h2>
        {can(P.REPORTS_GENERATE) && reportable && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setGenerating(true)}
          >
            <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
            {reports.length > 0 ? t('reports.regenerate') : t('reports.generate')}
          </button>
        )}
      </div>

      {!reportable && (
        <div className="alert alert-secondary py-2 px-3 small">
          {t('reports.markFinalHint')}
        </div>
      )}

      {isLoading ? (
        <div className="placeholder-glow">
          <span className="placeholder col-12 d-block" style={{ height: 100 }} />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState title={t('reports.noReports')} icon="file-earmark-pdf" />
      ) : (
        <ul className="list-group">
          {reports.map((report) => (
            <li
              key={report.id}
              className="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2"
            >
              <div className="min-vw-0">
                <span className="fw-medium">
                  {t('reports.version', { n: report.version })}
                </span>
                {report.isFinal && (
                  <span className="badge text-bg-success ms-2">{t('reports.final')}</span>
                )}
                <span className="badge text-bg-light ms-2">{report.locale}</span>
                <StateBadge value={report.status} namespace="importStatus" className="ms-2" />

                <div className="small text-body-secondary mt-1">
                  {report.generatedAt
                    ? new Date(report.generatedAt).toLocaleString(i18n.language)
                    : '—'}
                  {report.pageCount && ` · ${t('reports.pages', { count: report.pageCount })}`}
                  {report.sizeBytes &&
                    ` · ${Math.round(report.sizeBytes / 1024)} KB`}
                </div>

                {report.status === 'FAILED' && report.error && (
                  <div className="small text-danger mt-1">{report.error}</div>
                )}
              </div>

              <div className="d-flex gap-2 flex-shrink-0">
                {['QUEUED', 'GENERATING'].includes(report.status) && (
                  <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                )}
                {report.status === 'READY' && can(P.REPORTS_DOWNLOAD) && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => download(report.id)}
                  >
                    <i className="bi bi-download me-1" aria-hidden="true" />
                    {t('reports.download')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={generating}
        onClose={() => setGenerating(false)}
        title={t('reports.generate')}
        busy={generate.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setGenerating(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending && (
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              )}
              {t('reports.generate')}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold">{t('reports.locale')}</label>
          <select
            className="form-select form-select-sm"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
          >
            <option value="AR">{t('reports.localeAr')}</option>
            <option value="EN">{t('reports.localeEn')}</option>
            <option value="BILINGUAL">{t('reports.localeBilingual')}</option>
          </select>
        </div>

        <div className="form-check">
          <input
            className="form-check-input"
            type="checkbox"
            id="report-final"
            checked={isFinal}
            onChange={(event) => setIsFinal(event.target.checked)}
          />
          <label className="form-check-label small" htmlFor="report-final">
            <span className="fw-semibold">{t('reports.markFinal')}</span>
            <span className="d-block text-body-secondary">
              {t('reports.markFinalHint')}
            </span>
          </label>
        </div>
      </Modal>
    </>
  );
}
