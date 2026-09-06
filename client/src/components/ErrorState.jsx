import { useTranslation } from 'react-i18next';

/**
 * A failure the user can act on.
 *
 * Shows the server's own message when there is one — it is written for a user
 * and is usually more specific than anything this component could say — and
 * always offers a retry, because most of these are transient.
 */
export default function ErrorState({ error, onRetry }) {
  const { t } = useTranslation();

  const message =
    error?.friendlyMessage ??
    (typeof error === 'string' ? error : t('common.errorHint'));

  return (
    <div className="text-center py-5 px-3">
      <i
        className="bi bi-exclamation-triangle text-warning"
        style={{ fontSize: '2.5rem' }}
        aria-hidden="true"
      />
      <p className="fw-semibold mt-3 mb-1">{t('common.error')}</p>
      <p className="text-body-secondary small mb-3" style={{ whiteSpace: 'pre-line' }}>
        {message}
      </p>
      {onRetry && (
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onRetry}>
          <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
