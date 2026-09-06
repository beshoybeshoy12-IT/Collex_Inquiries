import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName, setLanguage, LANGUAGES } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * The user's own account.
 *
 * CHANGING A PASSWORD ENDS EVERY OTHER SESSION, and the screen says so before
 * the user commits. The usual reason somebody changes a password is that they
 * think it is compromised — leaving the other sessions alive would defeat the
 * act — but the current session survives, because signing somebody out of the
 * screen they just used feels like a failure rather than a security measure.
 */
export default function Profile() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();

  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  const { data: sessions } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: async () => (await api.get('/auth/sessions')).data,
  });

  const changePassword = useMutation({
    mutationFn: async () =>
      (
        await api.post('/auth/change-password', {
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        })
      ).data,
    onSuccess: () => {
      toast.success(t('auth.passwordChanged'));
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      queryClient.invalidateQueries({ queryKey: ['my-sessions'] });
    },
    onError: (error) => {
      // The password policy returns every rule that failed, not just the first.
      const message = Array.isArray(error.details?.message)
        ? error.details.message.map(localiseServerMessage).join('\n')
        : localiseServerMessage(error.friendlyMessage);
      toast.error(message);
    },
  });

  const logoutAll = useMutation({
    mutationFn: async () => (await api.post('/auth/logout-all')).data,
    onSuccess: () => {
      // Every session is gone, including this one.
      signOut();
    },
    onError: (error) => toast.error(error),
  });

  const mismatch =
    passwords.newPassword.length > 0 &&
    passwords.confirmPassword.length > 0 &&
    passwords.newPassword !== passwords.confirmPassword;

  return (
    <>
      <PageHeader title={t('auth.profile')} subtitle={user?.email} />

      <div className="row g-3">
        <div className="col-12 col-lg-5">
          <Panel title={t('users.user')} className="mb-3">
            <Field label={t('users.fullName')}>{user?.fullName}</Field>
            <Field label={t('users.email')}>
              <span dir="ltr">{user?.email}</span>
            </Field>
            <Field label={t('users.role')}>
              {user?.role ? localisedName(user.role, i18n.language) : null}
            </Field>
            <Field label={t('nav.company')}>
              {user?.tenant ? localisedName(user.tenant, i18n.language) : null}
            </Field>
            <Field label={t('roles.permissions')}>
              <span className="badge text-bg-light">
                {user?.permissions?.length ?? 0}
              </span>
            </Field>
          </Panel>

          <Panel title={t('app.language')}>
            <div className="btn-group btn-group-sm w-100">
              {Object.values(LANGUAGES).map((language) => (
                <button
                  key={language.code}
                  type="button"
                  className={`btn btn-outline-secondary ${
                    i18n.language === language.code ? 'active' : ''
                  }`}
                  onClick={() => setLanguage(language.code)}
                >
                  {language.name}
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <div className="col-12 col-lg-7">
          <Panel title={t('auth.changePassword')} className="mb-3">
            <div className="mb-2">
              <label className="form-label small fw-semibold">
                {t('auth.currentPassword')}
              </label>
              <input
                type="password"
                dir="ltr"
                autoComplete="current-password"
                className="form-control form-control-sm"
                value={passwords.currentPassword}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    currentPassword: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mb-2">
              <label className="form-label small fw-semibold">
                {t('auth.newPassword')}
              </label>
              <input
                type="password"
                dir="ltr"
                autoComplete="new-password"
                className="form-control form-control-sm"
                value={passwords.newPassword}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    newPassword: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mb-2">
              <label className="form-label small fw-semibold">
                {t('auth.confirmPassword')}
              </label>
              <input
                type="password"
                dir="ltr"
                autoComplete="new-password"
                className={`form-control form-control-sm ${mismatch ? 'is-invalid' : ''}`}
                value={passwords.confirmPassword}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    confirmPassword: event.target.value,
                  }))
                }
              />
              {mismatch && (
                <div className="invalid-feedback">{t('auth.passwordMismatch')}</div>
              )}
            </div>

            <p className="small text-body-secondary">{t('auth.passwordChanged')}</p>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => changePassword.mutate()}
              disabled={
                !passwords.currentPassword ||
                passwords.newPassword.length < 10 ||
                mismatch ||
                changePassword.isPending
              }
            >
              {changePassword.isPending && (
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              )}
              {t('common.save')}
            </button>
          </Panel>

          <Panel
            title={t('auth.sessions')}
            actions={
              <button
                type="button"
                className="btn btn-sm btn-outline-danger py-0"
                onClick={() => setSigningOutEverywhere(true)}
              >
                {t('auth.signOutEverywhere')}
              </button>
            }
            bodyClassName="p-0"
          >
            <ul className="list-group list-group-flush">
              {(sessions ?? []).map((session) => (
                <li key={session.id} className="list-group-item small">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="min-vw-0">
                      <div className="truncate">
                        {session.device ?? session.userAgent ?? '—'}
                      </div>
                      <div className="text-body-secondary mono">{session.ip ?? '—'}</div>
                    </div>
                    <div className="text-end text-body-secondary text-nowrap">
                      <div>{t('auth.lastUsed')}</div>
                      <div>
                        {new Date(session.lastUsedAt).toLocaleString(i18n.language)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {(sessions ?? []).length === 0 && (
                <li className="list-group-item small text-body-secondary">—</li>
              )}
            </ul>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={signingOutEverywhere}
        onClose={() => setSigningOutEverywhere(false)}
        onConfirm={() => logoutAll.mutate()}
        title={t('auth.signOutEverywhere')}
        message={t('auth.sessions')}
        busy={logoutAll.isPending}
      />
    </>
  );
}
