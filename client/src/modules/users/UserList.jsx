import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useGovernorates, useRoles, usePermissionCatalog } from '../../hooks/useCatalog';
import PageHeader from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import Modal, { ConfirmDialog } from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import CredentialDialog from '../../components/CredentialDialog';
import { useToast } from '../../components/Toast';
import { StateBadge } from '../../components/Badges';
import { MultiSelect } from '../investigators/InvestigatorList';

/**
 * Web user management.
 *
 * RANK DECIDES WHAT IS OFFERED. The server refuses an action on a user at or
 * above the caller's own level; this screen hides those actions rather than
 * showing buttons that 403. The check is duplicated deliberately — the server
 * one is the control, this one is the courtesy.
 *
 * A generated password is shown once, in a dialog that will not close until
 * the administrator confirms they have copied it. There is no path that
 * retrieves it later, because it was hashed the moment it was created.
 */
export default function UserList() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user: currentUser } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [permissionsFor, setPermissionsFor] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [credential, setCredential] = useState(null);
  const [form, setForm] = useState(emptyUser());

  const { data: roles } = useRoles();
  const { data: governorates } = useGovernorates();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users', page, search],
    queryFn: async () =>
      (await api.get('/users', { params: { page, limit: 25, search: search || undefined } }))
        .data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: async () => (await api.post('/users', cleanUser(form))).data,
    onSuccess: (result) => {
      setCreating(false);
      setForm(emptyUser());
      setCredential({
        title: result.user.fullName,
        identifier: result.user.email,
        identifierLabel: t('users.email'),
        password: result.temporaryPassword,
      });
      invalidate();
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  const update = useMutation({
    mutationFn: async () =>
      (await api.patch(`/users/${editing.id}`, cleanUser(form))).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setEditing(null);
      invalidate();
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  const act = useMutation({
    mutationFn: async ({ kind, target }) => {
      if (kind === 'status') {
        return (
          await api.patch(`/users/${target.id}/status`, {
            status: target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
          })
        ).data;
      }
      if (kind === 'reset') {
        return (await api.post(`/users/${target.id}/reset-password`)).data;
      }
      if (kind === 'sessions') {
        return (await api.post(`/users/${target.id}/revoke-sessions`)).data;
      }
      if (kind === 'unlock') {
        return (await api.post(`/users/${target.id}/unlock`)).data;
      }
      return (await api.delete(`/users/${target.id}`)).data;
    },
    onSuccess: (result, variables) => {
      setConfirming(null);
      if (result?.temporaryPassword) {
        setCredential({
          title: variables.target.fullName,
          identifier: variables.target.email,
          identifierLabel: t('users.email'),
          password: result.temporaryPassword,
        });
      } else {
        toast.success(t('common.saved'));
      }
      invalidate();
    },
    onError: (mutationError) => {
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
      setConfirming(null);
    },
  });

  /** Mirrors the server rule: strictly higher rank, and never yourself. */
  const canActOn = (target) => {
    if (currentUser?.isSuperAdmin) return true;
    if (target.id === currentUser?.id) return false;
    if (target.isSuperAdmin) return false;
    return (currentUser?.role?.rank ?? 0) > (target.role?.rank ?? 0);
  };

  const columns = [
    {
      key: 'fullName',
      header: t('users.user'),
      sortable: true,
      render: (row) => (
        <div>
          <div className="fw-medium">{row.fullName}</div>
          <div className="small text-body-secondary">{row.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('users.role'),
      render: (row) =>
        row.role ? (
          <span className="badge text-bg-light">
            {localisedName(row.role, i18n.language)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <>
          <StateBadge value={row.status} namespace="userStatus" />
          {row.lockedUntil && new Date(row.lockedUntil) > new Date() && (
            <span className="badge text-bg-danger ms-1">{t('users.locked')}</span>
          )}
        </>
      ),
    },
    { key: 'department', header: t('users.department') },
    {
      key: 'lastLoginAt',
      header: t('users.lastLogin'),
      sortable: true,
      render: (row) => (
        <span className="small">
          {row.lastLoginAt
            ? new Date(row.lastLoginAt).toLocaleString(i18n.language)
            : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        canActOn(row) ? (
          <Dropdown label="" icon="three-dots" align="end">
            {can(P.USERS_EDIT) && (
              <li>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setEditing(row);
                    setForm(userToForm(row));
                  }}
                >
                  {t('common.edit')}
                </button>
              </li>
            )}
            {can(P.PERMISSIONS_ASSIGN) && (
              <li>
                <button
                  className="dropdown-item"
                  onClick={() => setPermissionsFor(row)}
                >
                  {t('users.permissionOverrides')}
                </button>
              </li>
            )}
            {can(P.USERS_RESET_PASSWORD) && (
              <li>
                <button
                  className="dropdown-item"
                  onClick={() => setConfirming({ kind: 'reset', target: row })}
                >
                  {t('users.resetPassword')}
                </button>
              </li>
            )}
            {can(P.USERS_MANAGE_SESSIONS) && (
              <li>
                <button
                  className="dropdown-item"
                  onClick={() => setConfirming({ kind: 'sessions', target: row })}
                >
                  {t('users.revokeSessions')}
                </button>
              </li>
            )}
            {row.lockedUntil && can(P.USERS_EDIT) && (
              <li>
                <button
                  className="dropdown-item"
                  onClick={() => setConfirming({ kind: 'unlock', target: row })}
                >
                  {t('users.unlock')}
                </button>
              </li>
            )}
            {can(P.USERS_DISABLE) && (
              <li>
                <button
                  className="dropdown-item"
                  onClick={() => setConfirming({ kind: 'status', target: row })}
                >
                  {row.status === 'ACTIVE' ? t('users.disable') : t('users.enable')}
                </button>
              </li>
            )}
            {can(P.USERS_DELETE) && (
              <>
                <li>
                  <hr className="dropdown-divider" />
                </li>
                <li>
                  <button
                    className="dropdown-item text-danger"
                    onClick={() => setConfirming({ kind: 'delete', target: row })}
                  >
                    {t('common.delete')}
                  </button>
                </li>
              </>
            )}
          </Dropdown>
        ) : null,
    },
  ];

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const formFields = (
    <>
      <div className="row g-2 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">
            {t('users.fullName')} <span className="text-danger">*</span>
          </label>
          <input
            className="form-control form-control-sm"
            value={form.fullName}
            onChange={set('fullName')}
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">
            {t('users.email')} <span className="text-danger">*</span>
          </label>
          <input
            type="email"
            dir="ltr"
            className="form-control form-control-sm"
            value={form.email}
            onChange={set('email')}
          />
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold">{t('users.phone')}</label>
          <input
            className="form-control form-control-sm mono"
            dir="ltr"
            value={form.phone}
            onChange={set('phone')}
          />
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label small fw-semibold">
            {t('users.employeeCode')}
          </label>
          <input
            className="form-control form-control-sm mono"
            dir="ltr"
            value={form.employeeCode}
            onChange={set('employeeCode')}
          />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('users.role')}</label>
          <select
            className="form-select form-select-sm"
            value={form.roleId}
            onChange={set('roleId')}
          >
            <option value="">—</option>
            {(roles ?? [])
              // A user cannot assign a role at or above their own level, so
              // those are not offered.
              .filter(
                (role) =>
                  currentUser?.isSuperAdmin ||
                  role.rank < (currentUser?.role?.rank ?? 0),
              )
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {localisedName(role, i18n.language)}
                </option>
              ))}
          </select>
        </div>
        <div className="col-6 col-md-6">
          <label className="form-label small fw-semibold">{t('users.branch')}</label>
          <input
            className="form-control form-control-sm"
            value={form.branch}
            onChange={set('branch')}
          />
        </div>
        <div className="col-6 col-md-6">
          <label className="form-label small fw-semibold">{t('users.department')}</label>
          <input
            className="form-control form-control-sm"
            value={form.department}
            onChange={set('department')}
          />
        </div>
      </div>

      <MultiSelect
        label={t('users.allowedGovernorates')}
        hint={t('users.allowedGovernoratesHint')}
        items={governorates ?? []}
        selected={form.allowedGovernorateIds}
        onToggle={(id) =>
          setForm((current) => ({
            ...current,
            allowedGovernorateIds: current.allowedGovernorateIds.includes(id)
              ? current.allowedGovernorateIds.filter((value) => value !== id)
              : [...current.allowedGovernorateIds, id],
          }))
        }
        language={i18n.language}
      />
    </>
  );

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={data?.meta ? `${data.meta.total}` : undefined}
        actions={
          can(P.USERS_CREATE) && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setForm(emptyUser());
                setCreating(true);
              }}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('users.createUser')}
            </button>
          )
        }
      />

      <div className="card mb-3">
        <div className="card-body py-2">
          <input
            type="search"
            className="form-control form-control-sm"
            style={{ maxWidth: 340 }}
            placeholder={t('common.search')}
            defaultValue={search}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setSearch(event.target.value.trim());
                setPage(1);
              }
            }}
          />
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
            onPageChange={setPage}
          />
        </div>
      </div>

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        size="modal-lg"
        title={editing ? t('users.editUser') : t('users.createUser')}
        busy={create.isPending || update.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => (editing ? update.mutate() : create.mutate())}
              disabled={
                !form.fullName || !form.email || create.isPending || update.isPending
              }
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        {formFields}
      </Modal>

      {permissionsFor && (
        <PermissionOverrideDialog
          user={permissionsFor}
          onClose={() => setPermissionsFor(null)}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => act.mutate(confirming)}
        title={t('common.confirm')}
        message={confirmMessage(confirming, t)}
        tone={confirming?.kind === 'delete' ? 'danger' : 'primary'}
        busy={act.isPending}
      />

      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />
    </>
  );
}

/**
 * Per-user grants and denies, on top of the role.
 *
 * A deny beats the role grant, which is what makes it possible to exclude one
 * person from something their whole role may do without cloning the role.
 */
function PermissionOverrideDialog({ user, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data: catalog } = usePermissionCatalog();
  const { can, user: currentUser } = useAuth();

  const { data: detail } = useQuery({
    queryKey: ['user', user.id],
    queryFn: async () => (await api.get(`/users/${user.id}`)).data,
  });

  const [overrides, setOverrides] = useState(null);

  const current =
    overrides ??
    Object.fromEntries(
      (detail?.permissionOverrides ?? []).map((entry) => [
        entry.permissionCode,
        entry.granted,
      ]),
    );

  const rolePermissions = new Set(
    (detail?.role?.permissions ?? []).map((entry) => entry.permissionCode),
  );

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/users/${user.id}/permissions`, {
          overrides: Object.entries(current).map(([permissionCode, granted]) => ({
            permissionCode,
            granted,
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

  const cycle = (code) => {
    setOverrides((existing) => {
      const next = { ...(existing ?? current) };
      // inherited → granted → denied → inherited
      if (!(code in next)) next[code] = true;
      else if (next[code]) next[code] = false;
      else delete next[code];
      return next;
    });
  };

  const categories = [...new Set((catalog?.permissions ?? []).map((p) => p.category))];

  return (
    <Modal
      open
      onClose={onClose}
      size="modal-lg"
      title={`${t('users.permissionOverrides')} — ${user.fullName}`}
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
      <p className="small text-body-secondary">{t('users.permissionOverridesHint')}</p>

      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {categories.map((category) => (
          <div key={category} className="mb-3">
            <h3 className="h6 small text-uppercase text-body-secondary">{category}</h3>
            <div className="d-flex flex-column gap-1">
              {(catalog?.permissions ?? [])
                .filter((permission) => permission.category === category)
                .map((permission) => {
                  const state =
                    permission.code in current
                      ? current[permission.code]
                        ? 'granted'
                        : 'denied'
                      : rolePermissions.has(permission.code)
                        ? 'inherited'
                        : 'none';

                  // Nobody can grant a permission they do not hold themselves.
                  const grantable =
                    currentUser?.isSuperAdmin || can(permission.code);

                  return (
                    <button
                      key={permission.code}
                      type="button"
                      className="btn btn-sm text-start d-flex justify-content-between align-items-center border"
                      onClick={() => grantable && cycle(permission.code)}
                      disabled={!grantable}
                      title={!grantable ? t('roles.cannotGrantWhatYouLack') : undefined}
                    >
                      <span className="small">
                        {i18n.language === 'ar' ? permission.labelAr : permission.labelEn}
                        <span className="mono text-body-tertiary ms-2" style={{ fontSize: '.7rem' }}>
                          {permission.code}
                        </span>
                      </span>
                      <span
                        className={`badge text-bg-${
                          state === 'granted'
                            ? 'success'
                            : state === 'denied'
                              ? 'danger'
                              : state === 'inherited'
                                ? 'light'
                                : 'body-tertiary'
                        }`}
                      >
                        {state === 'granted'
                          ? t('users.granted')
                          : state === 'denied'
                            ? t('users.denied')
                            : state === 'inherited'
                              ? t('users.inherited')
                              : '—'}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function confirmMessage(confirming, t) {
  if (!confirming) return '';
  switch (confirming.kind) {
    case 'reset':
      return t('investigators.temporaryPasswordHint');
    case 'sessions':
      return t('users.revokeSessions');
    case 'unlock':
      return t('users.unlock');
    case 'delete':
      return t('common.confirmDelete');
    default:
      return confirming.target?.status === 'ACTIVE'
        ? t('users.disable')
        : t('users.enable');
  }
}

function emptyUser() {
  return {
    fullName: '',
    email: '',
    phone: '',
    employeeCode: '',
    roleId: '',
    branch: '',
    department: '',
    allowedGovernorateIds: [],
  };
}

function userToForm(user) {
  return {
    fullName: user.fullName ?? '',
    email: user.email ?? '',
    phone: user.phone ?? '',
    employeeCode: user.employeeCode ?? '',
    roleId: user.roleId ?? '',
    branch: user.branch ?? '',
    department: user.department ?? '',
    allowedGovernorateIds: user.allowedGovernorateIds ?? [],
  };
}

/** Strip empty strings — the server treats them as values, not as absent. */
function cleanUser(form) {
  const out = { ...form };
  for (const key of ['phone', 'employeeCode', 'branch', 'department', 'roleId']) {
    if (!out[key]) delete out[key];
  }
  return out;
}
