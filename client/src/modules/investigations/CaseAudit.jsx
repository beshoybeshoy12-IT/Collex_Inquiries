import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { actionLabel, changeLines, severityLabel } from '../../utils/auditLabels';

/**
 * The audit trail for one case, as sentences.
 *
 * "Mahmoud moved the case to On site", not `CASE_ON_SITE` with
 * `status: EN_ROUTE → ON_SITE`. The code stays on hover for whoever needs it.
 * Internal ids are never shown; a changed investigator reads "Investigator:
 * changed".
 */
export default function CaseAudit({ investigationId }) {
  const { t, i18n } = useTranslation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['case-audit', investigationId],
    queryFn: async () =>
      (
        await api.get(`/audit/entity/Investigation/${investigationId}`, {
          params: { limit: 100 },
        })
      ).data,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-12 d-block" style={{ height: 180 }} />
      </div>
    );
  }

  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title={t('audit.noEntries')} icon="shield-check" />;
  }

  const locale = i18n.language === 'en' ? 'en-GB' : 'ar-EG';

  return (
    <div className="card">
      <ul className="audit-feed">
        {rows.map((entry) => {
          const lines = changeLines(entry.oldValue, entry.newValue, t, i18n);
          const reason = entry.metadata?.reason;
          const system = !entry.actorName;
          return (
            <li key={entry.id} className={`audit-entry audit-${entry.severity?.toLowerCase()}`}>
              <span className="audit-entry__dot" aria-hidden="true">
                <i className={`bi bi-${iconFor(entry)}`} />
              </span>
              <div className="audit-entry__body">
                <div className="audit-entry__head">
                  <span className="audit-entry__action" title={entry.action}>
                    {actionLabel(entry.action, t, i18n)}
                  </span>
                  {entry.severity && entry.severity !== 'INFO' && (
                    <span className={`audit-entry__severity sev-${entry.severity.toLowerCase()}`}>
                      {severityLabel(entry.severity, t, i18n)}
                    </span>
                  )}
                </div>
                <div className="audit-entry__meta">
                  <span>
                    <i
                      className={`bi ${system ? 'bi-cpu' : 'bi-person'} me-1`}
                      aria-hidden="true"
                    />
                    {system ? t('auditMisc.system') : entry.actorName}
                  </span>
                  <span>{new Date(entry.createdAt).toLocaleString(locale)}</span>
                </div>
                {lines.length > 0 && (
                  <ul className="audit-entry__changes">
                    {lines.map((line) => (
                      <li key={line.key}>
                        <span className="text-body-secondary">{line.label}:</span>{' '}
                        {line.idOnly ? (
                          <span>{t('auditMisc.changed')}</span>
                        ) : (
                          <>
                            {line.from !== '—' && (
                              <>
                                <span className="audit-entry__from">{line.from}</span>{' '}
                                <i className="bi bi-arrow-left-short audit-arrow" aria-hidden="true" />{' '}
                              </>
                            )}
                            <span className="fw-semibold">{line.to}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {reason && (
                  <div className="audit-entry__reason">
                    <span className="text-body-secondary">{t('auditMisc.reason')}:</span>{' '}
                    <span dir="auto">{reason}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function iconFor(entry) {
  const action = entry.action ?? '';
  if (entry.severity === 'CRITICAL' || action === 'SLA_ESCALATION') return 'alarm';
  if (action.startsWith('GPS_')) return 'geo-alt';
  if (action.startsWith('FILE_')) return 'paperclip';
  if (action.startsWith('ASSIGNMENT_') || action.includes('ASSIGN')) return 'person-check';
  if (action.startsWith('QC_')) return 'patch-check';
  if (action.startsWith('REPORT_')) return 'file-earmark-text';
  if (action.includes('FORM')) return 'ui-checks';
  if (action === 'CASE_STATUS_OVERRIDE') return 'shield-exclamation';
  if (action.startsWith('CASE_')) return 'arrow-left-right';
  return 'dot';
}
