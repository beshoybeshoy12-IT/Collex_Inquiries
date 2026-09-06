import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';

/**
 * The audit trail for one case.
 *
 * Shows the changed fields rather than whole rows, because that is what the
 * server stores — a diff is readable, and it does not duplicate every national
 * id and address into a second table.
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

  return (
    <div className="card">
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr>
              <th>{t('audit.action')}</th>
              <th>{t('audit.actor')}</th>
              <th>{t('audit.changes')}</th>
              <th>{t('common.createdAt')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <span className="mono small">{entry.action}</span>
                  {entry.severity !== 'INFO' && (
                    <span
                      className={`badge ms-2 text-bg-${severityTone(entry.severity)}`}
                    >
                      {entry.severity}
                    </span>
                  )}
                </td>
                <td className="small">{entry.actorName ?? 'system'}</td>
                <td className="small">
                  <ChangeList oldValue={entry.oldValue} newValue={entry.newValue} />
                </td>
                <td className="small text-nowrap">
                  {new Date(entry.createdAt).toLocaleString(i18n.language)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function severityTone(severity) {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'WARNING') return 'warning';
  if (severity === 'NOTICE') return 'info';
  return 'secondary';
}

function ChangeList({ oldValue, newValue }) {
  if (!newValue || Object.keys(newValue).length === 0) return '—';

  return (
    <ul className="list-unstyled mb-0">
      {Object.entries(newValue).map(([key, value]) => (
        <li key={key}>
          <span className="text-body-secondary">{key}:</span>{' '}
          <span className="text-decoration-line-through text-body-tertiary">
            {formatValue(oldValue?.[key])}
          </span>{' '}
          <i className="bi bi-arrow-right" aria-hidden="true" />{' '}
          <span className="fw-medium">{formatValue(value)}</span>
        </li>
      ))}
    </ul>
  );
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
