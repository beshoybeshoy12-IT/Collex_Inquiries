import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * Form templates and their versions.
 *
 * The version list is the point of this screen. A published version is frozen;
 * a draft is editable; and the badge next to each one is what tells an
 * administrator which of the two they are about to open. Getting that wrong —
 * editing what you thought was a draft — is the mistake this layout exists to
 * prevent.
 */
export default function FormList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', nameAr: '', nameEn: '' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['form-templates-admin'],
    queryFn: async () => (await api.get('/forms')).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post('/forms', form)).data,
    onSuccess: (created) => {
      setCreating(false);
      setForm({ code: '', nameAr: '', nameEn: '' });
      queryClient.invalidateQueries({ queryKey: ['form-templates-admin'] });
      navigate(`/admin/forms/${created.id}`);
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={t('forms.title')}
        actions={
          can(P.FORMS_CREATE) && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setCreating(true)}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('common.add')}
            </button>
          )
        }
      />

      {isLoading ? (
        <div className="placeholder-glow">
          <span className="placeholder col-12 d-block" style={{ height: 200 }} />
        </div>
      ) : !data?.length ? (
        <EmptyState title={t('forms.noForms')} icon="ui-checks" />
      ) : (
        <div className="row g-3">
          {data.map((template) => {
            const published = template.versions?.find((version) => version.isPublished);
            const draft = template.versions?.find((version) => !version.isPublished);

            return (
              <div className="col-12 col-md-6 col-xl-4" key={template.id}>
                <Panel
                  title={localisedName(template, i18n.language)}
                  actions={
                    <span className="d-flex gap-1">
                      {published && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary py-0"
                          title={t('inquirySheet.printBlank')}
                          aria-label={t('inquirySheet.printBlank')}
                          onClick={() =>
                            window.open(`/print/form/${template.id}`, '_blank', 'noopener')
                          }
                        >
                          <i className="bi bi-printer" aria-hidden="true" />
                        </button>
                      )}
                      <Link
                        to={`/admin/forms/${template.id}`}
                        className="btn btn-sm btn-outline-secondary py-0"
                      >
                        {t('forms.builder')}
                      </Link>
                    </span>
                  }
                >
                  <div className="small text-body-secondary mb-2 mono">
                    {template.code}
                  </div>

                  <div className="d-flex flex-wrap gap-1 mb-2">
                    {published && (
                      <span className="badge text-bg-success">
                        {t('forms.published')} v{published.version}
                      </span>
                    )}
                    {draft && (
                      <span className="badge text-bg-warning">
                        {t('forms.draft')} v{draft.version}
                      </span>
                    )}
                    {!published && !draft && (
                      <span className="badge text-bg-light">—</span>
                    )}
                  </div>

                  {template.investigationTypes?.length > 0 && (
                    <div className="d-flex flex-wrap gap-1">
                      {template.investigationTypes.map((type) => (
                        <span key={type.id} className="badge text-bg-light">
                          {localisedName(type, i18n.language)}
                        </span>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('common.add')}
        busy={create.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setCreating(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => create.mutate()}
              disabled={!form.code || !form.nameAr || !form.nameEn || create.isPending}
            >
              {t('common.create')}
            </button>
          </>
        }
      >
        <div className="mb-2">
          <label className="form-label small fw-semibold">{t('common.code')}</label>
          <input
            className="form-control form-control-sm mono text-uppercase"
            dir="ltr"
            value={form.code}
            onChange={(event) =>
              setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
          />
        </div>
        <div className="mb-2">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input
            className="form-control form-control-sm"
            value={form.nameAr}
            onChange={(event) =>
              setForm((current) => ({ ...current, nameAr: event.target.value }))
            }
          />
        </div>
        <div>
          <label className="form-label small fw-semibold">{t('common.nameEn')}</label>
          <input
            className="form-control form-control-sm"
            dir="ltr"
            value={form.nameEn}
            onChange={(event) =>
              setForm((current) => ({ ...current, nameEn: event.target.value }))
            }
          />
        </div>
      </Modal>
    </>
  );
}
