import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-5">
      <i
        className="bi bi-compass text-body-tertiary"
        style={{ fontSize: '2.5rem' }}
        aria-hidden="true"
      />
      <p className="fw-semibold mt-3 mb-1">{t('errors.notFound')}</p>
      <Link to="/" className="btn btn-sm btn-outline-primary mt-2">
        {t('nav.dashboard')}
      </Link>
    </div>
  );
}
