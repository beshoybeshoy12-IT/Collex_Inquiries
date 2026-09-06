import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useGovernorates } from '../../hooks/useCatalog';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

export default function CustomerList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyCustomer());

  const { data: governorates } = useGovernorates();

  const query = Object.fromEntries(params.entries());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['customers', query],
    queryFn: async () =>
      (
        await api.get('/customers', {
          params: { ...query, page: Number(query.page ?? 1), limit: 25 },
        })
      ).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post('/customers', form)).data,
    onSuccess: (created) => {
      toast.success(t('common.saved'));
      setCreating(false);
      setForm(emptyCustomer());
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate(`/customers/${created.id}`);
    },
    onError: (mutationError) => {
      // A 409 carries the existing customer, so the user can go to it rather
      // than being told only that it exists.
      const existing = mutationError.details?.existing;
      toast.error(
        existing
          ? `${localiseServerMessage(mutationError.friendlyMessage)} — ${existing.fullName}`
          : localiseServerMessage(mutationError.friendlyMessage),
      );
    },
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const columns = [
    {
      key: 'fullName',
      header: t('customers.fullName'),
      sortable: true,
      render: (row) => <span className="fw-medium">{row.fullName}</span>,
    },
    {
      key: 'nationalId',
      header: t('customers.nationalId'),
      render: (row) => <span className="mono">{row.nationalId ?? '—'}</span>,
    },
    {
      key: 'mobile',
      header: t('customers.mobile'),
      render: (row) => <span className="mono">{row.mobile ?? '—'}</span>,
    },
    {
      key: 'workplaceName',
      header: t('customers.workplaceName'),
      render: (row) => row.workplaceName ?? '—',
    },
    {
      key: 'governorate',
      header: t('cases.governorate'),
      render: (row) => localisedName(row.governorate, i18n.language) || '—',
    },
    {
      key: 'investigations',
      header: t('cases.title'),
      render: (row) => (
        <span className="badge text-bg-light">{row._count?.investigations ?? 0}</span>
      ),
    },
  ];

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      <PageHeader
        title={t('customers.title')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
        actions={
          can(P.CUSTOMERS_CREATE) && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setCreating(true)}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('customers.createCustomer')}
            </button>
          )
        }
      />

      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2">
            <div className="col-12 col-md-6">
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder={t('customers.searchPlaceholder')}
                defaultValue={query.search ?? ''}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setFilter('search', event.target.value.trim());
                }}
              />
            </div>
            <div className="col-12 col-md-3">
              <select
                className="form-select form-select-sm"
                value={query.governorateId ?? ''}
                onChange={(event) => setFilter('governorateId', event.target.value)}
              >
                <option value="">{t('cases.governorate')}</option>
                {(governorates ?? []).map((governorate) => (
                  <option key={governorate.id} value={governorate.id}>
                    {localisedName(governorate, i18n.language)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <DataTable
            columns={columns}
            rows={data?.data}
            meta={data?.meta}
            loading={isLoading}
            error={error}
            onRetry={refetch}
            onPageChange={(next) => setFilter('page', next)}
            onSort={(key, order) => {
              const next = new URLSearchParams(params);
              next.set('sortBy', key);
              next.set('sortOrder', order);
              setParams(next, { replace: true });
            }}
            sortBy={query.sortBy}
            sortOrder={query.sortOrder}
            onRowClick={(row) => navigate(`/customers/${row.id}`)}
          />
        </div>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('customers.createCustomer')}
        size="modal-lg"
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
              disabled={form.fullName.trim().length < 3 || create.isPending}
            >
              {t('common.create')}
            </button>
          </>
        }
      >
        <div className="row g-2">
          <div className="col-12 col-md-6">
            <label className="form-label small fw-semibold">
              {t('customers.fullName')} <span className="text-danger">*</span>
            </label>
            <input className="form-control form-control-sm" value={form.fullName} onChange={set('fullName')} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold">{t('customers.nationalId')}</label>
            <input className="form-control form-control-sm mono" dir="ltr" value={form.nationalId} onChange={set('nationalId')} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold">{t('customers.mobile')}</label>
            <input className="form-control form-control-sm mono" dir="ltr" value={form.mobile} onChange={set('mobile')} />
          </div>
          <div className="col-12">
            <label className="form-label small fw-semibold">{t('customers.residenceAddress')}</label>
            <input className="form-control form-control-sm" value={form.residenceAddress} onChange={set('residenceAddress')} />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label small fw-semibold">{t('customers.workplaceName')}</label>
            <input className="form-control form-control-sm" value={form.workplaceName} onChange={set('workplaceName')} />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label small fw-semibold">{t('cases.governorate')}</label>
            <select className="form-select form-select-sm" value={form.governorateId} onChange={set('governorateId')}>
              <option value="">—</option>
              {(governorates ?? []).map((governorate) => (
                <option key={governorate.id} value={governorate.id}>
                  {localisedName(governorate, i18n.language)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}

function emptyCustomer() {
  return {
    fullName: '',
    nationalId: '',
    mobile: '',
    residenceAddress: '',
    workplaceName: '',
    governorateId: '',
  };
}
