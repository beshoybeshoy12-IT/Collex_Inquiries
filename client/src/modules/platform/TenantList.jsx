import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import CredentialDialog from '../../components/CredentialDialog';
import { useToast } from '../../components/Toast';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The platform console — the companies contracted onto the system.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  THIS IS THE ONLY SCREEN IN THE APPLICATION THAT LOOKS ACROSS TENANTS, and
 *  it is reachable by exactly one kind of account: `isSuperAdmin`. That is not
 *  a permission and cannot be granted through any API — see
 *  `prisma/seed-platform-admin.ts` for why, and `TenantsController` for the
 *  server-side gate that actually enforces it. The route guard and the hidden
 *  navigation entry are conveniences; they are not the control.
 *
 *  WHAT THIS SCREEN CAN DO THAT A COMPANY ADMINISTRATOR CANNOT:
 *
 *    · create a company at all;
 *    · change its status — suspending ENDS EVERY SESSION IN IT IMMEDIATELY;
 *    · raise or lower plan limits and the subscription window.
 *
 *  Those three live here rather than in `CompanySettings` because a tenant
 *  raising its own user cap or un-suspending itself is not a request the API
 *  can even express — the DTO omits the fields and `forbidNonWhitelisted`
 *  turns an attempt into a 400.
 *
 *  PROVISIONING RETURNS A PASSWORD EXACTLY ONCE. The server generates it,
 *  stores only the hash, and hands back the plaintext in that one response. If
 *  this screen loses it, nobody can read it back — hence `CredentialDialog`,
 *  which will not close until the operator ticks that they have copied it.
 */
export default function TenantList() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [statusFor, setStatusFor] = useState(null);
  const [limitsFor, setLimitsFor] = useState(null);
  const [credential, setCredential] = useState(null);

  /**
   * The company this operator's own account lives in.
   *
   * `tenantId` rather than `tenant.id`: the nested company object arrives with
   * the login response, but `/auth/me` — which is what a reload resolves the
   * principal from — returns only the flat id. Reading the nested one alone
   * makes the marker below appear after signing in and vanish after a refresh.
   */
  const ownTenantId = user?.tenantId ?? user?.tenant?.id ?? null;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: async () => (await api.get('/tenants')).data,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });

  const tenants = useMemo(() => {
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.code, row.nameAr, row.nameEn, row.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [data, search]);

  const summary = useMemo(() => {
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    return {
      total: rows.length,
      active: rows.filter((row) => row.status === 'ACTIVE').length,
      trial: rows.filter((row) => row.status === 'TRIAL').length,
      halted: rows.filter((row) =>
        ['SUSPENDED', 'EXPIRED'].includes(row.status),
      ).length,
    };
  }, [data]);

  const columns = [
    {
      key: 'code',
      header: t('common.code'),
      render: (row) => (
        <div className="d-flex align-items-center gap-2">
          <span className="mono fw-semibold">{row.code}</span>
          {row.id === ownTenantId && (
            <span
              className="badge text-bg-light fw-normal"
              title={t('platform.ownTenantHint')}
            >
              {t('platform.ownTenant')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'name',
      header: t('common.name'),
      render: (row) => (
        <div className="min-vw-0">
          <div className="truncate">{localisedName(row, i18n.language)}</div>
          <div className="small text-body-secondary truncate">
            {i18n.language === 'ar' ? row.nameEn : row.nameAr}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <TenantStatusBadge status={row.status} />,
    },
    {
      key: 'users',
      header: t('platform.colUsers'),
      render: (row) => <Usage used={row._count?.users} limit={row.maxWebUsers} />,
    },
    {
      key: 'investigators',
      header: t('platform.colInvestigators'),
      render: (row) => (
        <Usage used={row._count?.investigators} limit={row.maxInvestigators} />
      ),
    },
    {
      key: 'cases',
      header: t('platform.colCases'),
      render: (row) => (
        <span className="badge text-bg-light">
          {row._count?.investigations ?? 0}
        </span>
      ),
    },
    {
      key: 'subscriptionEnd',
      header: t('platform.colSubscription'),
      render: (row) => <Expiry value={row.subscriptionEnd} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-outline-secondary py-0"
            onClick={() => setLimitsFor(row)}
          >
            {t('platform.limits')}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary py-0"
            onClick={() => setStatusFor(row)}
          >
            {t('common.status')}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('platform.tenants')}
        subtitle={t('platform.tenantsSubtitle')}
        actions={
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setCreating(true)}
          >
            <i className="bi bi-building-add me-1" aria-hidden="true" />
            {t('platform.newTenant')}
          </button>
        }
      />

      <div className="row g-2 mb-3">
        <SummaryCard label={t('platform.totalTenants')} value={summary.total} />
        <SummaryCard
          label={t('platform.statusActive')}
          value={summary.active}
          tone="success"
        />
        <SummaryCard
          label={t('platform.statusTrial')}
          value={summary.trial}
          tone="info"
        />
        <SummaryCard
          label={t('platform.halted')}
          value={summary.halted}
          tone={summary.halted > 0 ? 'danger' : 'secondary'}
        />
      </div>

      <div className="card">
        <div className="card-body">
          <div className="mb-3" style={{ maxWidth: 340 }}>
            <input
              className="form-control form-control-sm"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('platform.searchPlaceholder')}
              aria-label={t('common.search')}
            />
          </div>

          <DataTable
            columns={columns}
            rows={tenants}
            loading={isLoading}
            error={error}
            onRetry={refetch}
            emptyTitle={t('platform.noTenants')}
            emptyHint={t('platform.noTenantsHint')}
          />
        </div>
      </div>

      {creating && (
        <CreateTenantDialog
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            invalidate();
            setCreating(false);
            // The one and only time this password is readable.
            setCredential({
              title: result.tenant.nameEn || result.tenant.nameAr,
              identifierLabel: t('platform.adminEmail'),
              identifier: result.admin.email,
              password: result.temporaryPassword,
            });
          }}
        />
      )}

      {statusFor && (
        <StatusDialog
          tenant={statusFor}
          isOwnTenant={statusFor.id === ownTenantId}
          onClose={() => setStatusFor(null)}
          onSaved={() => {
            invalidate();
            setStatusFor(null);
            toast.success(t('common.saved'));
          }}
        />
      )}

      {limitsFor && (
        <LimitsDialog
          tenant={limitsFor}
          onClose={() => setLimitsFor(null)}
          onSaved={() => {
            invalidate();
            setLimitsFor(null);
            toast.success(t('common.saved'));
          }}
        />
      )}

      <CredentialDialog
        credential={credential}
        onClose={() => setCredential(null)}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Provisioning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One company, its default roles and its first administrator.
 *
 * The server does all three in a single transaction: a company with no roles is
 * one nobody can be created in, and a company with roles but no administrator
 * is one nobody can sign into. This dialog therefore asks for the administrator
 * up front rather than offering it as a later step.
 */
function CreateTenantDialog({ onClose, onCreated }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [form, setForm] = useState({
    code: '',
    nameAr: '',
    nameEn: '',
    adminName: '',
    adminEmail: '',
    status: 'TRIAL',
    email: '',
    phone: '',
    taxId: '',
    defaultLocale: 'ar',
    maxWebUsers: 50,
    maxInvestigators: 200,
    subscriptionEnd: '',
  });

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        maxWebUsers: Number(form.maxWebUsers),
        maxInvestigators: Number(form.maxInvestigators),
      };
      // The DTO runs under `forbidNonWhitelisted`: an empty optional string is
      // a 400 (it fails @IsEmail, @IsDateString), not a silently ignored field.
      for (const key of [
        'email',
        'phone',
        'taxId',
        'subscriptionEnd',
      ]) {
        if (!payload[key]) delete payload[key];
      }
      if (payload.subscriptionEnd) {
        payload.subscriptionEnd = new Date(payload.subscriptionEnd).toISOString();
      }
      return (await api.post('/tenants', payload)).data;
    },
    onSuccess: onCreated,
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const ready =
    /^[A-Z0-9_]+$/.test(form.code) &&
    form.nameAr.trim() &&
    form.nameEn.trim() &&
    form.adminName.trim() &&
    /.+@.+\..+/.test(form.adminEmail);

  return (
    <Modal
      open
      onClose={onClose}
      size="modal-lg"
      busy={create.isPending}
      title={t('platform.newTenant')}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => create.mutate()}
            disabled={!ready || create.isPending}
          >
            {create.isPending && (
              <span
                className="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
              />
            )}
            {t('platform.provision')}
          </button>
        </>
      }
    >
      <div className="row g-2">
        <div className="col-12">
          <h6 className="small fw-semibold text-body-secondary mb-1">
            {t('platform.companySection')}
          </h6>
        </div>

        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-code">
            {t('common.code')}
          </label>
          <input
            id="tenant-code"
            className="form-control form-control-sm mono"
            dir="ltr"
            value={form.code}
            placeholder="ACME"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
              }))
            }
          />
          <div className="form-text small">{t('platform.codeHint')}</div>
        </div>

        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-name-ar">
            {t('common.nameAr')}
          </label>
          <input
            id="tenant-name-ar"
            className="form-control form-control-sm"
            value={form.nameAr}
            onChange={set('nameAr')}
          />
        </div>

        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-name-en">
            {t('common.nameEn')}
          </label>
          <input
            id="tenant-name-en"
            className="form-control form-control-sm"
            dir="ltr"
            value={form.nameEn}
            onChange={set('nameEn')}
          />
        </div>

        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-email">
            {t('customers.email')}
          </label>
          <input
            id="tenant-email"
            className="form-control form-control-sm"
            dir="ltr"
            value={form.email}
            onChange={set('email')}
          />
        </div>

        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-phone">
            {t('investigators.phone')}
          </label>
          <input
            id="tenant-phone"
            className="form-control form-control-sm mono"
            dir="ltr"
            value={form.phone}
            onChange={set('phone')}
          />
        </div>

        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-tax">
            {t('settings.taxId')}
          </label>
          <input
            id="tenant-tax"
            className="form-control form-control-sm mono"
            dir="ltr"
            value={form.taxId}
            onChange={set('taxId')}
          />
        </div>

        <div className="col-12">
          <hr className="my-2" />
          <h6 className="small fw-semibold text-body-secondary mb-1">
            {t('platform.adminSection')}
          </h6>
          <p className="small text-body-secondary mb-2">
            {t('platform.adminSectionHint')}
          </p>
        </div>

        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold" htmlFor="tenant-admin-name">
            {t('platform.adminName')}
          </label>
          <input
            id="tenant-admin-name"
            className="form-control form-control-sm"
            value={form.adminName}
            onChange={set('adminName')}
          />
        </div>

        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold" htmlFor="tenant-admin-email">
            {t('platform.adminEmail')}
          </label>
          <input
            id="tenant-admin-email"
            className="form-control form-control-sm"
            dir="ltr"
            type="email"
            value={form.adminEmail}
            onChange={set('adminEmail')}
          />
        </div>

        <div className="col-12">
          <hr className="my-2" />
          <h6 className="small fw-semibold text-body-secondary mb-1">
            {t('platform.planSection')}
          </h6>
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold" htmlFor="tenant-status">
            {t('common.status')}
          </label>
          <select
            id="tenant-status"
            className="form-select form-select-sm"
            value={form.status}
            onChange={set('status')}
          >
            {['TRIAL', 'ACTIVE'].map((status) => (
              <option key={status} value={status}>
                {t(`platform.status${status.charAt(0)}${status.slice(1).toLowerCase()}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold" htmlFor="tenant-locale">
            {t('settings.defaultLocale')}
          </label>
          <select
            id="tenant-locale"
            className="form-select form-select-sm"
            value={form.defaultLocale}
            onChange={set('defaultLocale')}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold" htmlFor="tenant-max-users">
            {t('settings.maxUsers')}
          </label>
          <input
            id="tenant-max-users"
            type="number"
            min="1"
            className="form-control form-control-sm"
            value={form.maxWebUsers}
            onChange={set('maxWebUsers')}
          />
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold" htmlFor="tenant-max-inv">
            {t('settings.maxInvestigators')}
          </label>
          <input
            id="tenant-max-inv"
            type="number"
            min="1"
            className="form-control form-control-sm"
            value={form.maxInvestigators}
            onChange={set('maxInvestigators')}
          />
        </div>

        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold" htmlFor="tenant-sub-end">
            {t('settings.subscriptionEnds')}
          </label>
          <input
            id="tenant-sub-end"
            type="date"
            className="form-control form-control-sm"
            value={form.subscriptionEnd}
            onChange={set('subscriptionEnd')}
          />
          <div className="form-text small">{t('platform.subscriptionHint')}</div>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Suspending or expiring a company signs every one of its users out on the
 * spot, rather than waiting up to fifteen minutes for access tokens to lapse.
 * That is what "suspend" means to whoever asked for it, and it is worth saying
 * plainly before the button is pressed.
 */
function StatusDialog({ tenant, isOwnTenant, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [status, setStatus] = useState(tenant.status);
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/tenants/${tenant.id}/status`, {
          status,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        })
      ).data,
    onSuccess: onSaved,
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const disruptive = status !== 'ACTIVE' && status !== 'TRIAL';

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      title={`${t('common.status')} — ${tenant.code}`}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn btn-${disruptive ? 'danger' : 'primary'}`}
            onClick={() => save.mutate()}
            disabled={save.isPending || status === tenant.status}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="form-label small fw-semibold" htmlFor="tenant-new-status">
        {t('common.status')}
      </label>
      <select
        id="tenant-new-status"
        className="form-select form-select-sm"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        {['ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED'].map((value) => (
          <option key={value} value={value}>
            {t(`platform.status${value.charAt(0)}${value.slice(1).toLowerCase()}`)}
          </option>
        ))}
      </select>

      <label className="form-label small fw-semibold mt-3" htmlFor="tenant-reason">
        {t('common.reason')}
      </label>
      <textarea
        id="tenant-reason"
        className="form-control form-control-sm"
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t('platform.reasonPlaceholder')}
      />
      <div className="form-text small">{t('platform.reasonHint')}</div>

      {disruptive && (
        <div className="alert alert-warning small py-2 px-3 mt-3 mb-0">
          <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
          {t('platform.suspendWarning')}
        </div>
      )}

      {disruptive && isOwnTenant && (
        <div className="alert alert-danger small py-2 px-3 mt-2 mb-0">
          <i className="bi bi-shield-exclamation me-1" aria-hidden="true" />
          {t('platform.ownTenantWarning')}
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Plan limits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Limits are a ceiling, not a truncation: lowering `maxWebUsers` below the
 * number a company already has does not delete anybody, it stops the next
 * creation. The current figures are shown beside each field so that is a
 * deliberate choice rather than a surprise.
 */
function LimitsDialog({ tenant, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [form, setForm] = useState({
    maxWebUsers: tenant.maxWebUsers ?? 50,
    maxInvestigators: tenant.maxInvestigators ?? 200,
    subscriptionEnd: tenant.subscriptionEnd
      ? new Date(tenant.subscriptionEnd).toISOString().slice(0, 10)
      : '',
  });

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/tenants/${tenant.id}/limits`, {
          maxWebUsers: Number(form.maxWebUsers),
          maxInvestigators: Number(form.maxInvestigators),
          ...(form.subscriptionEnd
            ? {
                subscriptionEnd: new Date(form.subscriptionEnd).toISOString(),
              }
            : {}),
        })
      ).data,
    onSuccess: onSaved,
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      title={`${t('platform.limits')} — ${tenant.code}`}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
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
      <div className="row g-2">
        <div className="col-6">
          <label className="form-label small fw-semibold" htmlFor="limit-users">
            {t('settings.maxUsers')}
          </label>
          <input
            id="limit-users"
            type="number"
            min="1"
            className="form-control form-control-sm"
            value={form.maxWebUsers}
            onChange={set('maxWebUsers')}
          />
          <div className="form-text small">
            {t('platform.currentlyUsing', { value: tenant._count?.users ?? 0 })}
          </div>
        </div>

        <div className="col-6">
          <label className="form-label small fw-semibold" htmlFor="limit-inv">
            {t('settings.maxInvestigators')}
          </label>
          <input
            id="limit-inv"
            type="number"
            min="1"
            className="form-control form-control-sm"
            value={form.maxInvestigators}
            onChange={set('maxInvestigators')}
          />
          <div className="form-text small">
            {t('platform.currentlyUsing', {
              value: tenant._count?.investigators ?? 0,
            })}
          </div>
        </div>

        <div className="col-12">
          <label className="form-label small fw-semibold" htmlFor="limit-sub">
            {t('settings.subscriptionEnds')}
          </label>
          <input
            id="limit-sub"
            type="date"
            className="form-control form-control-sm"
            value={form.subscriptionEnd}
            onChange={set('subscriptionEnd')}
          />
          <div className="form-text small">{t('platform.renewHint')}</div>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Small pieces
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'danger',
  EXPIRED: 'dark',
};

function TenantStatusBadge({ status }) {
  const { t } = useTranslation();
  const key = `platform.status${status.charAt(0)}${status.slice(1).toLowerCase()}`;
  return (
    <span className={`badge text-bg-${STATUS_TONE[status] ?? 'secondary'}`}>
      {t(key, status)}
    </span>
  );
}

/** Used against the cap, with the bar tinted once the cap is close. */
function Usage({ used = 0, limit = 0 }) {
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const tone = percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'success';

  return (
    <div style={{ minWidth: 88 }}>
      <div className="small">
        {used} <span className="text-body-tertiary">/ {limit}</span>
      </div>
      <div className="progress" style={{ height: 4 }}>
        <div
          className={`progress-bar bg-${tone}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A subscription date is only interesting relative to today, so this says how
 * long is left rather than making the reader subtract.
 */
function Expiry({ value }) {
  const { t, i18n } = useTranslation();
  if (!value) return <span className="text-body-tertiary">—</span>;

  const date = new Date(value);
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const tone = days < 0 ? 'text-danger' : days <= 30 ? 'text-warning' : '';

  return (
    <div className="small">
      <div>{date.toLocaleDateString(i18n.language)}</div>
      <div className={tone}>
        {days < 0
          ? t('platform.expiredAgo', { value: Math.abs(days) })
          : t('platform.daysLeft', { value: days })}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone = 'secondary' }) {
  return (
    <div className="col-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body py-2 px-3">
          <div className="small text-body-secondary">{label}</div>
          <div className={`fs-4 fw-semibold text-${tone}`}>{value}</div>
        </div>
      </div>
    </div>
  );
}
