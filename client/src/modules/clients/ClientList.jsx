import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { localisedName } from '../../i18n';
import { localiseServerMessage } from '../../services/api';
import { useClients } from '../../hooks/useClients';
import { saveErrorMessage, saveFromApi } from '../../utils/saveFromApi';
import ClientLogo from './ClientLogo';

/**
 * Clients ("الجهات"): one card per bank or company, each with its template,
 * its upload and its cases one click away.
 */
export default function ClientList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error, refetch } = useClients({ includeInactive: showArchived });

  const canManage = can(P.CLIENTS_MANAGE);
  const canUpload = can(P.IMPORTS_CREATE);

  const downloadTemplate = (client) =>
    saveFromApi(`/clients/${client.id}/template`, {
      params: { lang: i18n.language === 'en' ? 'en' : 'ar' },
      fileName: t('clients.templateFileName', { name: localisedName(client, i18n.language) }),
    }).catch(async (failure) =>
      toast.error(localiseServerMessage(await saveErrorMessage(failure, t))),
    );

  return (
    <>
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={
          <>
            {can(P.IMPORTS_VIEW) && (
              <Link to="/imports" className="btn btn-sm btn-outline-secondary">
                <i className="bi bi-clock-history me-1" aria-hidden="true" />
                {t('clients.allUploads')}
              </Link>
            )}
            {canManage && (
              <Link to="/clients/new" className="btn btn-sm btn-primary">
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                {t('clients.add')}
              </Link>
            )}
          </>
        }
      />

      <div className="form-check form-switch mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          id="clients-archived"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        <label className="form-check-label small" htmlFor="clients-archived">
          {t('clients.showArchived')}
        </label>
      </div>

      {error && <ErrorState error={error} onRetry={refetch} />}

      {isLoading && (
        <div className="client-grid">
          {[0, 1, 2].map((key) => (
            <div key={key} className="card placeholder-glow" style={{ height: 170 }}>
              <span className="placeholder col-12 h-100" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && (data ?? []).length === 0 && (
        <EmptyState
          icon="buildings"
          title={t('clients.empty')}
          hint={t('clients.emptyHint')}
          action={
            canManage && (
              <Link to="/clients/new" className="btn btn-primary btn-sm">
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                {t('clients.add')}
              </Link>
            )
          }
        />
      )}

      <div className="client-grid">
        {(data ?? []).map((client) => {
          const name = localisedName(client, i18n.language);
          const other = i18n.language === 'en' ? client.nameAr : client.nameEn;
          const fields = client.templateFields?.length ?? 0;
          return (
            <div key={client.id} className={`card client-card ${client.isActive ? '' : 'is-archived'}`}>
              <button
                type="button"
                className="client-card__main"
                onClick={() => navigate(`/clients/${client.id}`)}
              >
                <ClientLogo client={client} size={52} />
                <span className="min-vw-0">
                  <span className="client-card__name truncate d-block">{name}</span>
                  <span className="client-card__other truncate d-block">{other}</span>
                </span>
              </button>

              <div className="client-card__stats">
                <span>
                  <i className="bi bi-layout-three-columns me-1" aria-hidden="true" />
                  {t('clients.fieldCount', { count: fields })}
                </span>
                <Link to={`/investigations?clientAccountId=${client.id}`}>
                  <i className="bi bi-folder2-open me-1" aria-hidden="true" />
                  {t('clients.caseCount', { count: client.investigationCount })}
                </Link>
                <span>
                  <i className="bi bi-upload me-1" aria-hidden="true" />
                  {t('clients.uploadCount', { count: client.importCount })}
                </span>
                {!client.isActive && (
                  <span className="badge text-bg-secondary">{t('clients.archived')}</span>
                )}
              </div>

              <div className="client-card__actions">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => downloadTemplate(client)}
                  disabled={fields === 0}
                  title={fields === 0 ? t('clients.noFieldsYet') : undefined}
                >
                  <i className="bi bi-download me-1" aria-hidden="true" />
                  {t('clients.template')}
                </button>
                {canUpload && client.isActive && (
                  <Link
                    to={`/clients/${client.id}/import`}
                    className={`btn btn-sm btn-primary ${fields === 0 ? 'disabled' : ''}`}
                    aria-disabled={fields === 0}
                  >
                    <i className="bi bi-file-earmark-arrow-up me-1" aria-hidden="true" />
                    {t('clients.upload')}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
        {canManage && (data ?? []).length > 0 && !showArchived && (
          <Link to="/clients/new" className="card client-card client-card--add">
            <i className="bi bi-plus-lg" aria-hidden="true" />
            {t('clients.add')}
          </Link>
        )}
      </div>
    </>
  );
}
