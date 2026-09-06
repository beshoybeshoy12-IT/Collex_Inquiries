import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useMediaCategories } from '../../hooks/useCatalog';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * Investigation types.
 *
 * These are ROWS, NOT AN ENUM — which is what lets each one carry its own field
 * form, its own report template and its own required photo categories. Adding
 * "Vehicle Verification" is configuration; nothing in the codebase branches on
 * one of these names.
 *
 * Changing the form template only affects cases assigned from that moment on:
 * every case pins its own form version at assignment, so work already in the
 * field keeps the questions it was given.
 */
export default function InvestigationTypeList() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investigation-types-admin'],
    queryFn: async () =>
      (await api.get('/investigation-types', { params: { limit: 100 } })).data,
  });

  const { data: forms } = useQuery({
    queryKey: ['form-templates'],
    queryFn: async () => (await api.get('/forms', { params: { activeOnly: true } })).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['investigation-types-admin'] });
    queryClient.invalidateQueries({ queryKey: ['investigation-types'] });
  };

  const remove = useMutation({
    mutationFn: async (type) =>
      (await api.delete(`/investigation-types/${type.id}`)).data,
    onSuccess: (result) => {
      toast.success(
        result.deactivated ? t('catalog.deactivatedInstead') : t('common.saved'),
      );
      setDeleting(null);
      invalidate();
    },
    onError: (mutationError) => {
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
      setDeleting(null);
    },
  });

  const columns = [
    {
      key: 'code',
      header: t('common.code'),
      render: (row) => (
        <span className="d-inline-flex align-items-center gap-2">
          <span
            className="rounded-circle d-inline-block"
            style={{
              width: 10,
              height: 10,
              backgroundColor: row.colorHex ?? '#6b7280',
            }}
            aria-hidden="true"
          />
          <span className="mono fw-semibold">{row.code}</span>
        </span>
      ),
    },
    {
      key: 'name',
      header: t('common.name'),
      render: (row) => (
        <div>
          <div>{localisedName(row, i18n.language)}</div>
          <div className="small text-body-secondary">
            {i18n.language === 'ar' ? row.nameEn : row.nameAr}
          </div>
        </div>
      ),
    },
    {
      key: 'form',
      header: t('catalog.formTemplate'),
      render: (row) =>
        row.formTemplate ? (
          <span className="badge text-bg-light">
            {localisedName(row.formTemplate, i18n.language)}
            {!row.formTemplate.publishedVersionId && (
              <span className="ms-1 text-warning">!</span>
            )}
          </span>
        ) : (
          <span className="text-body-tertiary">—</span>
        ),
    },
    {
      key: 'requiredPhotos',
      header: t('catalog.requiredPhotos'),
      render: (row) => (
        <div className="d-flex flex-wrap gap-1">
          {(row.requiredPhotoCategories ?? []).map((code) => (
            <span key={code} className="badge text-bg-light mono">
              {code}
            </span>
          ))}
          {(row.requiredPhotoCategories ?? []).length === 0 && '—'}
        </div>
      ),
    },
    {
      key: 'defaultSlaHours',
      header: t('catalog.defaultSla'),
      render: (row) => `${row.defaultSlaHours}h`,
    },
    {
      key: 'isActive',
      header: t('common.status'),
      render: (row) => (
        <span className={`badge text-bg-${row.isActive ? 'success' : 'secondary'}`}>
          {row.isActive ? t('common.active') : t('common.inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        can(P.INVESTIGATION_TYPES_MANAGE) && (
          <div className="btn-group btn-group-sm">
            <button
              type="button"
              className="btn btn-outline-secondary py-0"
              onClick={() => setEditing(row)}
            >
              {t('common.edit')}
            </button>
            <button
              type="button"
              className="btn btn-outline-danger py-0"
              onClick={() => setDeleting(row)}
            >
              {t('common.delete')}
            </button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('catalog.investigationTypes')}
        actions={
          can(P.INVESTIGATION_TYPES_MANAGE) && (
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

      <div className="card">
        <div className="card-body">
          <DataTable
            columns={columns}
            rows={data?.data}
            loading={isLoading}
            error={error}
            onRetry={refetch}
          />
        </div>
      </div>

      {(creating || editing) && (
        <TypeDialog
          type={editing}
          forms={forms ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting)}
        title={t('common.delete')}
        message={`${deleting?.code ?? ''}\n${t('catalog.deactivatedInstead')}`}
        busy={remove.isPending}
      />
    </>
  );
}

function TypeDialog({ type, forms, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data: categories } = useMediaCategories();

  const [form, setForm] = useState(() => ({
    code: type?.code ?? '',
    nameAr: type?.nameAr ?? '',
    nameEn: type?.nameEn ?? '',
    description: type?.description ?? '',
    colorHex: type?.colorHex ?? '#2563eb',
    defaultSlaHours: type?.defaultSlaHours ?? 48,
    formTemplateId: type?.formTemplateId ?? '',
    requiredPhotoCategories: type?.requiredPhotoCategories ?? [],
    isActive: type?.isActive ?? true,
  }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        defaultSlaHours: Number(form.defaultSlaHours),
        formTemplateId: form.formTemplateId || undefined,
      };
      if (type) delete payload.code;

      return type
        ? (await api.patch(`/investigation-types/${type.id}`, payload)).data
        : (await api.post('/investigation-types', payload)).data;
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      onSaved?.();
      onClose();
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      size="modal-lg"
      title={type ? t('common.edit') : t('common.add')}
      busy={save.isPending}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => save.mutate()}
            disabled={!form.code || !form.nameAr || !form.nameEn || save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="row g-2 mb-3">
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('common.code')}</label>
          <input
            className="form-control form-control-sm mono text-uppercase"
            dir="ltr"
            value={form.code}
            disabled={Boolean(type)}
            onChange={(event) =>
              setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
          />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input className="form-control form-control-sm" value={form.nameAr} onChange={set('nameAr')} />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('common.nameEn')}</label>
          <input className="form-control form-control-sm" dir="ltr" value={form.nameEn} onChange={set('nameEn')} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('catalog.defaultSla')}</label>
          <input type="number" className="form-control form-control-sm" value={form.defaultSlaHours} onChange={set('defaultSlaHours')} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('catalog.colour')}</label>
          <input type="color" className="form-control form-control-color form-control-sm w-100" value={form.colorHex} onChange={set('colorHex')} />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('catalog.formTemplate')}</label>
          <select className="form-select form-select-sm" value={form.formTemplateId} onChange={set('formTemplateId')}>
            <option value="">—</option>
            {forms.map((template) => (
              <option key={template.id} value={template.id}>
                {localisedName(template, i18n.language)}
                {!template.publishedVersionId ? ` (${t('forms.draft')})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="form-label small fw-semibold">{t('catalog.requiredPhotos')}</label>
      <div className="border rounded p-2 d-flex flex-wrap gap-1 mb-3">
        {(categories ?? [])
          .filter((category) => category.mediaType === 'PHOTO')
          .map((category) => (
            <button
              key={category.id}
              type="button"
              className={`btn btn-sm ${
                form.requiredPhotoCategories.includes(category.code)
                  ? 'btn-primary'
                  : 'btn-outline-secondary'
              }`}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  requiredPhotoCategories: current.requiredPhotoCategories.includes(
                    category.code,
                  )
                    ? current.requiredPhotoCategories.filter((code) => code !== category.code)
                    : [...current.requiredPhotoCategories, category.code],
                }))
              }
            >
              {localisedName(category, i18n.language)}
            </button>
          ))}
      </div>

      <div className="form-check">
        <input
          className="form-check-input"
          type="checkbox"
          id="type-active"
          checked={form.isActive}
          onChange={(event) =>
            setForm((current) => ({ ...current, isActive: event.target.checked }))
          }
        />
        <label className="form-check-label small" htmlFor="type-active">
          {t('common.active')}
        </label>
      </div>
    </Modal>
  );
}
