import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import {
  useGovernorates,
  useInvestigationTypes,
  useProducts,
} from '../../hooks/useCatalog';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { AvailabilityBadge, StateBadge } from '../../components/Badges';
import CredentialDialog from '../../components/CredentialDialog';

/**
 * Field investigators.
 *
 * A DIFFERENT POPULATION FROM WEB USERS, and a different screen. They sign in
 * on a handset with an employee code, they have coverage and qualifications
 * rather than permissions, and they never appear in user management.
 *
 * A newly created investigator starts IN_TRAINING: they can sign in to the
 * mobile app and learn it, but the assignment eligibility check refuses to give
 * them real work until somebody marks them ACTIVE.
 */
export default function InvestigatorList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyInvestigator());
  const [credential, setCredential] = useState(null);

  const { data: governorates } = useGovernorates();
  const { data: types } = useInvestigationTypes();
  const { data: products } = useProducts();

  const query = Object.fromEntries(params.entries());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investigators-list', query],
    queryFn: async () =>
      (
        await api.get('/investigators', {
          params: { ...query, page: Number(query.page ?? 1), limit: 25 },
        })
      ).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post('/investigators', {
          ...form,
          governorateIds: form.governorateIds,
          investigationTypeIds: form.investigationTypeIds,
          productIds: form.productIds,
          maxOpenCases: Number(form.maxOpenCases),
          maxDailyCases: Number(form.maxDailyCases),
        })
      ).data,
    onSuccess: (result) => {
      setCreating(false);
      setForm(emptyInvestigator());
      // Shown once and never retrievable — the dialog makes that explicit.
      setCredential({
        title: result.investigator.fullName,
        identifier: result.investigator.employeeCode,
        password: result.temporaryPassword,
      });
      queryClient.invalidateQueries({ queryKey: ['investigators-list'] });
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const toggleMulti = (key, id) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((value) => value !== id)
        : [...current[key], id],
    }));

  const columns = [
    {
      key: 'fullName',
      header: t('investigators.investigator'),
      sortable: true,
      render: (row) => (
        <div>
          <div className="fw-medium">{row.fullName}</div>
          <div className="small text-body-secondary mono">
            {row.employeeCode} · {row.phone}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <StateBadge value={row.status} namespace="investigatorStatus" />,
    },
    {
      key: 'availability',
      header: t('investigators.availability'),
      render: (row) => <AvailabilityBadge availability={row.availability} />,
    },
    {
      key: 'openCases',
      header: t('assignment.openCases'),
      render: (row) => (
        <div style={{ minWidth: 90 }}>
          <div className="d-flex justify-content-between small">
            <span>
              {row.openCases}/{row.maxOpenCases}
            </span>
          </div>
          <div className="progress" style={{ height: 4 }}>
            <div
              className={`progress-bar ${
                row.atCapacity ? 'bg-danger' : 'bg-success'
              }`}
              style={{ width: `${Math.min(100, row.capacityUsedPercent ?? 0)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'qualityScore',
      header: t('investigators.qualityScore'),
      sortable: true,
      render: (row) =>
        row.qualityScore != null ? (
          <span className="badge text-bg-light">
            <i className="bi bi-star-fill text-warning me-1" aria-hidden="true" />
            {row.qualityScore}%
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'completedCount',
      header: t('investigators.completedCount'),
      sortable: true,
    },
    {
      key: 'coverage',
      header: t('investigators.coverage'),
      render: (row) => (
        <span className="small">
          {row.governorateIds?.length > 0
            ? `${row.governorateIds.length} ${t('investigators.governorates')}`
            : t('common.all')}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('investigators.title')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
        actions={
          can(P.INVESTIGATORS_CREATE) && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setCreating(true)}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('investigators.createInvestigator')}
            </button>
          )
        }
      />

      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2">
            <div className="col-12 col-md-4">
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder={t('common.search')}
                defaultValue={query.search ?? ''}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setFilter('search', event.target.value.trim());
                }}
              />
            </div>
            <div className="col-6 col-md-3">
              <select
                className="form-select form-select-sm"
                value={query.status ?? ''}
                onChange={(event) => setFilter('status', event.target.value)}
              >
                <option value="">{t('common.status')}</option>
                {['ACTIVE', 'IN_TRAINING', 'INACTIVE', 'SUSPENDED'].map((status) => (
                  <option key={status} value={status}>
                    {t(`investigatorStatus.${status}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
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
            onRowClick={(row) => navigate(`/investigators/${row.id}`)}
          />
        </div>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        size="modal-lg"
        title={t('investigators.createInvestigator')}
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
              disabled={
                !form.employeeCode || !form.fullName || !form.phone || create.isPending
              }
            >
              {t('common.create')}
            </button>
          </>
        }
      >
        <div className="row g-2 mb-3">
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold">
              {t('investigators.employeeCode')} <span className="text-danger">*</span>
            </label>
            <input
              className="form-control form-control-sm mono"
              dir="ltr"
              value={form.employeeCode}
              onChange={set('employeeCode')}
            />
          </div>
          <div className="col-12 col-md-5">
            <label className="form-label small fw-semibold">
              {t('customers.fullName')} <span className="text-danger">*</span>
            </label>
            <input
              className="form-control form-control-sm"
              value={form.fullName}
              onChange={set('fullName')}
            />
          </div>
          <div className="col-6 col-md-4">
            <label className="form-label small fw-semibold">
              {t('investigators.phone')} <span className="text-danger">*</span>
            </label>
            <input
              className="form-control form-control-sm mono"
              dir="ltr"
              value={form.phone}
              onChange={set('phone')}
            />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold">
              {t('investigators.maxOpenCases')}
            </label>
            <input
              type="number"
              className="form-control form-control-sm"
              value={form.maxOpenCases}
              onChange={set('maxOpenCases')}
            />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold">
              {t('investigators.maxDailyCases')}
            </label>
            <input
              type="number"
              className="form-control form-control-sm"
              value={form.maxDailyCases}
              onChange={set('maxDailyCases')}
            />
          </div>
        </div>

        <MultiSelect
          label={t('investigators.governorates')}
          hint={t('users.allowedGovernoratesHint')}
          items={governorates ?? []}
          selected={form.governorateIds}
          onToggle={(id) => toggleMulti('governorateIds', id)}
          language={i18n.language}
        />

        <MultiSelect
          label={t('investigators.qualifiedTypes')}
          items={types ?? []}
          selected={form.investigationTypeIds}
          onToggle={(id) => toggleMulti('investigationTypeIds', id)}
          language={i18n.language}
        />

        <MultiSelect
          label={t('investigators.qualifiedProducts')}
          items={products ?? []}
          selected={form.productIds}
          onToggle={(id) => toggleMulti('productIds', id)}
          language={i18n.language}
        />
      </Modal>

      <CredentialDialog
        credential={credential}
        onClose={() => setCredential(null)}
      />
    </>
  );
}

export function MultiSelect({ label, hint, items, selected, onToggle, language }) {
  return (
    <div className="mb-3">
      <label className="form-label small fw-semibold">{label}</label>
      {hint && <div className="form-text small mb-1">{hint}</div>}
      <div
        className="border rounded p-2 d-flex flex-wrap gap-1"
        style={{ maxHeight: 140, overflowY: 'auto' }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn btn-sm ${
              selected.includes(item.id) ? 'btn-primary' : 'btn-outline-secondary'
            }`}
            onClick={() => onToggle(item.id)}
          >
            {localisedName(item, language)}
          </button>
        ))}
      </div>
    </div>
  );
}

function emptyInvestigator() {
  return {
    employeeCode: '',
    fullName: '',
    phone: '',
    email: '',
    maxOpenCases: 30,
    maxDailyCases: 15,
    governorateIds: [],
    investigationTypeIds: [],
    productIds: [],
  };
}
