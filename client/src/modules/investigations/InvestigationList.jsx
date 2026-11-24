import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useProducts, useInvestigationTypes, useGovernorates } from '../../hooks/useCatalog';
import { useClients } from '../../hooks/useClients';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import { PriorityBadge, SlaBadge, StatusBadge } from '../../components/Badges';
import { useToast } from '../../components/Toast';
import AssignModal from '../assignments/AssignModal';
import MoveCaseButton from './MoveCaseButton';
import CreateCaseModal from './CreateCaseModal';

const STATUS_GROUPS = [
  'NEW',
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'QC',
  'REWORK',
  'COMPLETED',
  'CLOSED',
];

/**
 * The case list.
 *
 * FILTERS LIVE IN THE URL, not in component state. A coordinator who has
 * narrowed to "overdue residence checks in Giza" needs to be able to send that
 * to a colleague, keep it in a browser tab, and still have it after a reload —
 * none of which works if the filters are in `useState`. It also makes the
 * sidebar links plain hrefs rather than special cases.
 *
 * Bulk assignment is here rather than only on the assignment board, because
 * this is the screen a coordinator is already on when they decide to hand out
 * work.
 */
export default function InvestigationList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchDraft, setSearchDraft] = useState(params.get('search') ?? '');

  const { data: products } = useProducts();
  const { data: clients } = useClients({ includeInactive: true });
  const { data: types } = useInvestigationTypes();
  const { data: governorates } = useGovernorates();

  const query = Object.fromEntries(params.entries());
  const page = Number(query.page ?? 1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investigations', query],
    queryFn: async () =>
      (
        await api.get('/investigations', {
          params: { ...query, page, limit: Number(query.limit ?? 25) },
        })
      ).data,
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === '' || value == null) next.delete(key);
    else next.set(key, value);
    // Any filter change invalidates the current page number.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
    setSelected([]);
  };

  const archive = useMutation({
    mutationFn: async (ids) =>
      (await api.post('/investigations/archive', { investigationIds: ids })).data,
    onSuccess: (result) => {
      toast.success(
        `${result.archived} ${t('cases.archive').toLowerCase()}${
          result.skipped ? ` · ${result.skipped} ${t('imports.skipRow')}` : ''
        }`,
      );
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
    },
    onError: (mutationError) => toast.error(mutationError),
  });

  const columns = [
    {
      key: 'caseNumber',
      header: t('cases.caseNumber'),
      sortable: true,
      render: (row) => (
        <div>
          <Link to={`/investigations/${row.id}`} className="mono fw-semibold text-decoration-none">
            {row.caseNumber}
          </Link>
          {row.applicationNumber && (
            <div className="small text-body-secondary mono">{row.applicationNumber}</div>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      header: t('cases.customer'),
      render: (row) => (
        <div className="min-vw-0">
          <div className="truncate">{row.customer?.fullName}</div>
          {row.customer?.mobile && (
            <div className="small text-body-secondary mono">{row.customer.mobile}</div>
          )}
          {row.clientAccount && (
            <div className="small text-body-secondary truncate">
              <i className="bi bi-buildings me-1" aria-hidden="true" />
              {localisedName(row.clientAccount, i18n.language)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'investigationType',
      header: t('cases.investigationType'),
      render: (row) => (
        <div>
          <span
            className="badge rounded-pill"
            style={{
              backgroundColor: `${row.investigationType?.colorHex ?? '#6b7280'}1a`,
              color: row.investigationType?.colorHex ?? '#6b7280',
            }}
          >
            {localisedName(row.investigationType, i18n.language)}
          </span>
          <div className="small text-body-secondary truncate">
            {localisedName(row.product, i18n.language)}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'priority',
      header: t('cases.priority'),
      sortable: true,
      render: (row) => <PriorityBadge priority={row.priority} />,
    },
    {
      key: 'investigator',
      header: t('cases.investigator'),
      render: (row) =>
        row.investigator ? (
          <div className="min-vw-0">
            <div className="truncate">{row.investigator.fullName}</div>
            <div className="small text-body-secondary mono">
              {row.investigator.employeeCode}
            </div>
          </div>
        ) : (
          <span className="badge text-bg-warning-subtle text-warning-emphasis">
            {t('nav.unassigned')}
          </span>
        ),
    },
    {
      key: 'governorate',
      header: t('cases.governorate'),
      render: (row) => localisedName(row.governorate, i18n.language) || '—',
    },
    {
      key: 'dueAt',
      header: t('cases.sla'),
      sortable: true,
      render: (row) => <SlaBadge sla={row.sla} />,
    },
    {
      key: 'move',
      header: '',
      render: (row) => <MoveCaseButton caseId={row.id} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('cases.title')}
        subtitle={
          data?.meta ? `${data.meta.total} ${t('cases.title').toLowerCase()}` : undefined
        }
        actions={
          <>
            {selected.length > 0 && can(P.INVESTIGATIONS_ASSIGN) && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setAssigning(true)}
              >
                <i className="bi bi-person-check me-1" aria-hidden="true" />
                {t('assignment.bulkAssign')} ({selected.length})
              </button>
            )}
            {selected.length > 0 && can(P.INVESTIGATIONS_ARCHIVE) && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => archive.mutate(selected)}
                disabled={archive.isPending}
              >
                <i className="bi bi-archive me-1" aria-hidden="true" />
                {t('cases.archiveSelected')}
              </button>
            )}
            {can(P.INVESTIGATIONS_CREATE) && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setCreating(true)}
              >
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                {t('cases.createCase')}
              </button>
            )}
          </>
        }
      />

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="card-body py-3">
          <div className="row g-2">
            <div className="col-12 col-lg-4">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setFilter('search', searchDraft.trim());
                }}
              >
                <div className="input-group input-group-sm">
                  <span className="input-group-text">
                    <i className="bi bi-search" aria-hidden="true" />
                  </span>
                  <input
                    type="search"
                    className="form-control"
                    placeholder={t('cases.searchPlaceholder')}
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                  />
                </div>
              </form>
            </div>

            <div className="col-6 col-lg-2">
              <select
                className="form-select form-select-sm"
                value={query.statusGroup ?? ''}
                onChange={(event) => setFilter('statusGroup', event.target.value)}
              >
                <option value="">{t('common.status')}: {t('common.all')}</option>
                {STATUS_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {t(`statusGroup.${group}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-6 col-lg-2">
              <select
                className="form-select form-select-sm"
                value={query.investigationTypeId ?? ''}
                onChange={(event) => setFilter('investigationTypeId', event.target.value)}
              >
                <option value="">{t('cases.investigationType')}</option>
                {(types ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {localisedName(type, i18n.language)}
                  </option>
                ))}
              </select>
            </div>

            {(clients ?? []).length > 0 && (
              <div className="col-6 col-lg-2">
                <select
                  className="form-select form-select-sm"
                  value={query.clientAccountId ?? ''}
                  onChange={(event) => setFilter('clientAccountId', event.target.value)}
                  aria-label={t('clients.client')}
                >
                  <option value="">{t('clients.filterAll')}</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {localisedName(client, i18n.language)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="col-6 col-lg-2">
              <select
                className="form-select form-select-sm"
                value={query.productId ?? ''}
                onChange={(event) => setFilter('productId', event.target.value)}
              >
                <option value="">{t('cases.product')}</option>
                {(products ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {localisedName(product, i18n.language)}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-6 col-lg-2">
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

          <div className="d-flex flex-wrap align-items-center gap-3 mt-2">
            <div className="form-check form-check-inline small mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="filter-overdue"
                checked={query.overdue === 'true'}
                onChange={(event) =>
                  setFilter('overdue', event.target.checked ? 'true' : '')
                }
              />
              <label className="form-check-label" htmlFor="filter-overdue">
                {t('nav.overdue')}
              </label>
            </div>

            <div className="form-check form-check-inline small mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="filter-unassigned"
                checked={query.unassigned === 'true'}
                onChange={(event) =>
                  setFilter('unassigned', event.target.checked ? 'true' : '')
                }
              />
              <label className="form-check-label" htmlFor="filter-unassigned">
                {t('nav.unassigned')}
              </label>
            </div>

            <div className="form-check form-check-inline small mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="filter-reworked"
                checked={query.reworked === 'true'}
                onChange={(event) =>
                  setFilter('reworked', event.target.checked ? 'true' : '')
                }
              />
              <label className="form-check-label" htmlFor="filter-reworked">
                {t('nav.rework')}
              </label>
            </div>

            {params.toString() && (
              <button
                type="button"
                className="btn btn-sm btn-link text-decoration-none p-0 ms-auto"
                onClick={() => {
                  setParams(new URLSearchParams(), { replace: true });
                  setSearchDraft('');
                }}
              >
                {t('common.clearFilters')}
              </button>
            )}
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
            onRowClick={(row) => navigate(`/investigations/${row.id}`)}
            selectable={can(P.INVESTIGATIONS_ASSIGN)}
            selectedIds={selected}
            onSelectionChange={setSelected}
            emptyTitle={t('cases.noCases')}
          />
        </div>
      </div>

      <AssignModal
        open={assigning}
        onClose={() => setAssigning(false)}
        investigationIds={selected}
        onDone={() => {
          setSelected([]);
          queryClient.invalidateQueries({ queryKey: ['investigations'] });
          queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
        }}
      />

      <CreateCaseModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          navigate(`/investigations/${created.id}`);
        }}
      />
    </>
  );
}
