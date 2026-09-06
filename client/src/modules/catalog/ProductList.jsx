import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useInvestigationTypes } from '../../hooks/useCatalog';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * Products, and which investigation types each one enables.
 *
 * THE PAIRING IS THE INTERESTING PART. A row in `product_investigation_types`
 * is what makes "Credit Card + Residence" a case somebody can create; without
 * it the case-creation endpoint refuses. That is why the pairings are edited
 * here rather than hidden in a settings page nobody visits.
 *
 * `code` is immutable after creation — saved import mappings and SLA policies
 * point at it, and letting it change would silently detach both.
 */
export default function ProductList() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [pairingFor, setPairingFor] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products-admin'],
    queryFn: async () => (await api.get('/products', { params: { limit: 100 } })).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['products-admin'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const remove = useMutation({
    mutationFn: async (product) => (await api.delete(`/products/${product.id}`)).data,
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
      render: (row) => <span className="mono fw-semibold">{row.code}</span>,
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
      key: 'types',
      header: t('catalog.enabledTypes'),
      render: (row) => (
        <div className="d-flex flex-wrap gap-1">
          {(row.investigationTypes ?? [])
            .filter((pairing) => pairing.isActive)
            .slice(0, 4)
            .map((pairing) => (
              <span key={pairing.investigationTypeId} className="badge text-bg-light">
                {localisedName(pairing.investigationType, i18n.language)}
              </span>
            ))}
          {(row.investigationTypes ?? []).filter((p) => p.isActive).length > 4 && (
            <span className="badge text-bg-light">
              +{(row.investigationTypes ?? []).filter((p) => p.isActive).length - 4}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'defaultSlaHours',
      header: t('catalog.defaultSla'),
      render: (row) => `${row.defaultSlaHours}h`,
    },
    {
      key: 'price',
      header: t('catalog.price'),
      render: (row) => (row.price != null ? Number(row.price).toFixed(2) : '—'),
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
      key: 'usage',
      header: t('cases.title'),
      render: (row) => (
        <span className="badge text-bg-light">{row._count?.investigations ?? 0}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        can(P.PRODUCTS_MANAGE) && (
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
              className="btn btn-outline-secondary py-0"
              onClick={() => setPairingFor(row)}
            >
              {t('catalog.enabledTypes')}
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
        title={t('catalog.products')}
        actions={
          can(P.PRODUCTS_MANAGE) && (
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
        <ProductDialog
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}

      {pairingFor && (
        <PairingDialog
          product={pairingFor}
          onClose={() => setPairingFor(null)}
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

function ProductDialog({ product, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [form, setForm] = useState(() => ({
    code: product?.code ?? '',
    nameAr: product?.nameAr ?? '',
    nameEn: product?.nameEn ?? '',
    description: product?.description ?? '',
    defaultSlaHours: product?.defaultSlaHours ?? 48,
    defaultPriority: product?.defaultPriority ?? 'NORMAL',
    price: product?.price != null ? Number(product.price) : '',
    isActive: product?.isActive ?? true,
  }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        defaultSlaHours: Number(form.defaultSlaHours),
        price: form.price === '' ? undefined : Number(form.price),
      };
      // `code` is immutable; sending it on an update is rejected.
      if (product) delete payload.code;

      return product
        ? (await api.patch(`/products/${product.id}`, payload)).data
        : (await api.post('/products', payload)).data;
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
      title={product ? t('common.edit') : t('common.add')}
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
      <div className="row g-2">
        <div className="col-12">
          <label className="form-label small fw-semibold">{t('common.code')}</label>
          <input
            className="form-control form-control-sm mono text-uppercase"
            dir="ltr"
            value={form.code}
            disabled={Boolean(product)}
            onChange={(event) =>
              setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
          />
          {product && <div className="form-text small">{t('catalog.codeImmutable')}</div>}
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input className="form-control form-control-sm" value={form.nameAr} onChange={set('nameAr')} />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('common.nameEn')}</label>
          <input className="form-control form-control-sm" dir="ltr" value={form.nameEn} onChange={set('nameEn')} />
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold">{t('catalog.defaultSla')}</label>
          <input type="number" className="form-control form-control-sm" value={form.defaultSlaHours} onChange={set('defaultSlaHours')} />
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold">{t('catalog.defaultPriority')}</label>
          <select className="form-select form-select-sm" value={form.defaultPriority} onChange={set('defaultPriority')}>
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold">{t('catalog.price')}</label>
          <input type="number" step="0.01" className="form-control form-control-sm" value={form.price} onChange={set('price')} />
        </div>
        <div className="col-12">
          <div className="form-check">
            <input
              className="form-check-input"
              type="checkbox"
              id="product-active"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({ ...current, isActive: event.target.checked }))
              }
            />
            <label className="form-check-label small" htmlFor="product-active">
              {t('common.active')}
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PairingDialog({ product, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data: types } = useInvestigationTypes({ activeOnly: false });

  const [selected, setSelected] = useState(
    () =>
      new Set(
        (product.investigationTypes ?? [])
          .filter((pairing) => pairing.isActive)
          .map((pairing) => pairing.investigationTypeId),
      ),
  );

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.put(`/products/${product.id}/investigation-types`, {
          investigationTypes: [...selected].map((investigationTypeId) => ({
            investigationTypeId,
          })),
        })
      ).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      onSaved?.();
      onClose();
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('catalog.enabledTypes')} — ${localisedName(product, i18n.language)}`}
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
            disabled={save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="small text-body-secondary">{t('catalog.enabledTypesHint')}</p>

      <div className="d-flex flex-column gap-1">
        {(types ?? []).map((type) => (
          <div className="form-check" key={type.id}>
            <input
              className="form-check-input"
              type="checkbox"
              id={`pairing-${type.id}`}
              checked={selected.has(type.id)}
              onChange={(event) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(type.id);
                  else next.delete(type.id);
                  return next;
                })
              }
            />
            <label className="form-check-label small" htmlFor={`pairing-${type.id}`}>
              {localisedName(type, i18n.language)}
              <span className="mono text-body-tertiary ms-2" style={{ fontSize: '.7rem' }}>
                {type.code}
              </span>
            </label>
          </div>
        ))}
      </div>
    </Modal>
  );
}
