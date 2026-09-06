import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { usePermissionCatalog } from '../../hooks/useCatalog';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * Roles and their permission grants.
 *
 * THE MATRIX RENDERS FROM THE SERVER'S CATALOGUE, not from a list in this
 * repository. `GET /permissions` returns exactly what the guards check, so a
 * permission added to the backend appears here without a frontend change — and
 * a toggle can never exist for a permission nothing enforces.
 *
 * A SYSTEM ROLE'S GRANTS ARE EDITABLE; its code and its existence are not. A
 * tenant whose supervisors should also approve QC edits the supervisor role
 * rather than cloning it and leaving the original dangling.
 */
export default function RoleList() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user: currentUser } = useAuth();

  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: roles, isLoading, error, refetch } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/roles')).data,
  });

  const remove = useMutation({
    mutationFn: async (role) => (await api.delete(`/roles/${role.id}`)).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (mutationError) => {
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
      setDeleting(null);
    },
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  /** Same rule as the server: strictly below your own rank. */
  const canEdit = (role) =>
    currentUser?.isSuperAdmin || role.rank < (currentUser?.role?.rank ?? 0);

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        actions={
          can(P.ROLES_CREATE) && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setCreating(true)}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('roles.createRole')}
            </button>
          )
        }
      />

      {isLoading ? (
        <div className="placeholder-glow">
          <span className="placeholder col-12 d-block" style={{ height: 220 }} />
        </div>
      ) : (
        <div className="row g-3">
          {(roles ?? []).map((role) => (
            <div className="col-12 col-md-6 col-xl-4" key={role.id}>
              <Panel
                title={
                  <span>
                    {localisedName(role, i18n.language)}
                    {role.isSystem && (
                      <span className="badge text-bg-light ms-2">
                        {t('roles.systemRole')}
                      </span>
                    )}
                  </span>
                }
                actions={
                  canEdit(role) && (
                    <div className="btn-group btn-group-sm">
                      {can(P.ROLES_EDIT, P.PERMISSIONS_ASSIGN) && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary py-0"
                          onClick={() => setEditing(role)}
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      {can(P.ROLES_DELETE) && !role.isSystem && (
                        <button
                          type="button"
                          className="btn btn-outline-danger py-0"
                          onClick={() => setDeleting(role)}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  )
                }
              >
                <div className="d-flex justify-content-between small text-body-secondary mb-2">
                  <span className="mono">{role.code}</span>
                  <span>
                    {t('roles.rank')} {role.rank}
                  </span>
                </div>

                <div className="d-flex justify-content-between align-items-center">
                  <span className="badge text-bg-light">
                    {role.permissions?.length ?? 0} {t('roles.permissions')}
                  </span>
                  <span className="small text-body-secondary">
                    {t('roles.holders', { count: role._count?.users ?? 0 })}
                  </span>
                </div>
              </Panel>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <RoleDialog
          role={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['roles'] })}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting)}
        title={t('common.delete')}
        message={`${deleting ? localisedName(deleting, i18n.language) : ''}\n${t('roles.moveHoldersFirst')}`}
        busy={remove.isPending}
      />
    </>
  );
}

function RoleDialog({ role, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { can, user: currentUser } = useAuth();
  const { data: catalog } = usePermissionCatalog();

  const [form, setForm] = useState(() => ({
    code: role?.code ?? '',
    nameAr: role?.nameAr ?? '',
    nameEn: role?.nameEn ?? '',
    description: role?.description ?? '',
    rank: role?.rank ?? 10,
    permissions: role?.permissions?.map((entry) => entry.permissionCode) ?? [],
  }));

  const save = useMutation({
    mutationFn: async () =>
      role
        ? (await api.patch(`/roles/${role.id}`, form)).data
        : (await api.post('/roles', form)).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      onSaved?.();
      onClose();
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const categories = useMemo(
    () => [...new Set((catalog?.permissions ?? []).map((p) => p.category))],
    [catalog],
  );

  const toggle = (code) =>
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(code)
        ? current.permissions.filter((value) => value !== code)
        : [...current.permissions, code],
    }));

  const toggleCategory = (category) => {
    const codes = (catalog?.permissions ?? [])
      .filter((permission) => permission.category === category)
      // Only the ones this user could actually grant.
      .filter((permission) => currentUser?.isSuperAdmin || can(permission.code))
      .map((permission) => permission.code);

    const allSelected = codes.every((code) => form.permissions.includes(code));

    setForm((current) => ({
      ...current,
      permissions: allSelected
        ? current.permissions.filter((code) => !codes.includes(code))
        : [...new Set([...current.permissions, ...codes])],
    }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="modal-xl"
      title={role ? t('roles.editRole') : t('roles.createRole')}
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
        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('common.code')}</label>
          <input
            className="form-control form-control-sm mono text-uppercase"
            dir="ltr"
            value={form.code}
            disabled={Boolean(role)}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                code: event.target.value.toUpperCase(),
              }))
            }
          />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input
            className="form-control form-control-sm"
            value={form.nameAr}
            onChange={(event) =>
              setForm((current) => ({ ...current, nameAr: event.target.value }))
            }
          />
        </div>
        <div className="col-6 col-md-3">
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
        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('roles.rank')}</label>
          <input
            type="number"
            min={0}
            max={99}
            className="form-control form-control-sm"
            value={form.rank}
            onChange={(event) =>
              setForm((current) => ({ ...current, rank: Number(event.target.value) }))
            }
          />
          <div className="form-text small">{t('roles.rankHint')}</div>
        </div>
      </div>

      <h3 className="h6">{t('roles.permissions')}</h3>

      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {categories.map((category) => (
          <div key={category} className="mb-3">
            <div className="d-flex justify-content-between align-items-center mb-1">
              <h4 className="h6 small text-uppercase text-body-secondary mb-0">
                {category}
              </h4>
              <button
                type="button"
                className="btn btn-sm btn-link p-0 text-decoration-none small"
                onClick={() => toggleCategory(category)}
              >
                {t('roles.selectAll')}
              </button>
            </div>

            <div className="row g-1">
              {(catalog?.permissions ?? [])
                .filter((permission) => permission.category === category)
                .map((permission) => {
                  const grantable =
                    currentUser?.isSuperAdmin || can(permission.code);
                  return (
                    <div className="col-12 col-md-6 col-xl-4" key={permission.code}>
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`perm-${permission.code}`}
                          checked={form.permissions.includes(permission.code)}
                          disabled={!grantable}
                          onChange={() => toggle(permission.code)}
                        />
                        <label
                          className="form-check-label small"
                          htmlFor={`perm-${permission.code}`}
                          title={
                            !grantable ? t('roles.cannotGrantWhatYouLack') : permission.code
                          }
                        >
                          {i18n.language === 'ar'
                            ? permission.labelAr
                            : permission.labelEn}
                        </label>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
