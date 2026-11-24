import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName, setLanguage, LANGUAGES } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { Panel } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { setThemePreference, THEME_PREFERENCES, useTheme } from '../../theme';
import Dropdown from '../../components/Dropdown';
import UserAvatar from '../../components/UserAvatar';
import {
  PROFILE_IMAGE_ACCEPT,
  PROFILE_IMAGE_LIMITS,
  useProfileImageMutations,
  useProfileImages,
} from '../../hooks/useProfileImages';

/** Mirrors the server's minimum; the server's password policy is the control. */
const MIN_PASSWORD_LENGTH = 10;

const THEME_ICONS = { light: 'sun', dark: 'moon-stars', system: 'circle-half' };

/**
 * The user's own account: who they are, how the app looks for them, and
 * their password.
 *
 * CHANGING A PASSWORD ENDS EVERY OTHER SESSION, and the screen says so before
 * the user commits. The usual reason somebody changes a password is that they
 * think it is compromised — leaving the other sessions alive would defeat the
 * act — but the current session survives, because signing somebody out of the
 * screen they just used feels like a failure rather than a security measure.
 *
 * The list of active sessions is not shown here, by the product owner's
 * decision. The API behind it (`/auth/sessions`, `/auth/logout-all`) is
 * unchanged, and a password change still ends every other session.
 */
export default function Profile() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const { preference } = useTheme();

  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [visible, setVisible] = useState(false);

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
    },
    onError: (error) => {
      // The password policy returns every rule that failed, not just the first.
      const message = Array.isArray(error.details?.message)
        ? error.details.message.map(localiseServerMessage).join('\n')
        : localiseServerMessage(error.friendlyMessage);
      toast.error(message);
    },
  });

  const longEnough = passwords.newPassword.length >= MIN_PASSWORD_LENGTH;
  const matches =
    passwords.confirmPassword.length > 0 &&
    passwords.newPassword === passwords.confirmPassword;
  const mismatch = passwords.confirmPassword.length > 0 && !matches;

  const displayName = (() => {
    const parts = (user?.fullName ?? '').split(' / ');
    const name = parts.length === 2 ? parts[i18n.language === 'ar' ? 0 : 1] : parts[0];
    return name.replace(/\(.*?\)/g, '').trim();
  })();
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('');

  const setField = (key) => (event) =>
    setPasswords((current) => ({ ...current, [key]: event.target.value }));

  // ── Profile photo and cover ────────────────────────────────────────────
  const images = useProfileImages();
  const { upload, remove } = useProfileImageMutations();
  const avatarInput = useRef(null);
  const coverInput = useRef(null);
  const [busy, setBusy] = useState(null);

  const onFailure = (error) => toast.error(localiseServerMessage(error.friendlyMessage));

  const pick = (kind, event) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires a change.
    event.target.value = '';
    if (!file) return;

    if (!PROFILE_IMAGE_ACCEPT.split(',').includes(file.type)) {
      toast.error(t('profileMedia.badType'));
      return;
    }
    if (file.size > PROFILE_IMAGE_LIMITS[kind]) {
      toast.error(t('profileMedia.tooLarge', { mb: PROFILE_IMAGE_LIMITS[kind] / 1024 / 1024 }));
      return;
    }

    setBusy(kind);
    upload.mutate(
      { kind, file },
      {
        onSuccess: () =>
          toast.success(t(kind === 'avatar' ? 'profileMedia.photoUpdated' : 'profileMedia.coverUpdated')),
        onError: onFailure,
        onSettled: () => setBusy(null),
      },
    );
  };

  const drop = (kind) => {
    setBusy(kind);
    remove.mutate(kind, {
      onSuccess: () => toast.success(t('profileMedia.removed')),
      onError: onFailure,
      onSettled: () => setBusy(null),
    });
  };

  return (
    <>
      {/* ── Identity ───────────────────────────────────────────────────── */}
      <input
        ref={avatarInput}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        className="d-none"
        onChange={(event) => pick('avatar', event)}
      />
      <input
        ref={coverInput}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        className="d-none"
        onChange={(event) => pick('cover', event)}
      />

      <div className="card profile-hero mb-4">
        <div
          className={`profile-cover ${images.cover ? 'has-image' : ''}`}
          style={images.cover ? { backgroundImage: `url("${images.cover}")` } : undefined}
        >
          <div className="profile-cover-actions">
            <button
              type="button"
              className="btn btn-sm cover-btn"
              onClick={() => coverInput.current?.click()}
              disabled={busy === 'cover'}
            >
              {busy === 'cover' ? (
                <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
              ) : (
                <i className="bi bi-camera me-1" aria-hidden="true" />
              )}
              {t(images.hasCover ? 'profileMedia.changeCover' : 'profileMedia.addCover')}
            </button>
            {images.hasCover && (
              <button
                type="button"
                className="btn btn-sm cover-btn"
                onClick={() => drop('cover')}
                disabled={busy === 'cover'}
                aria-label={t('profileMedia.removeCover')}
                title={t('profileMedia.removeCover')}
              >
                <i className="bi bi-trash3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="profile-identity">
          <div className="avatar-edit-wrap">
            <UserAvatar src={images.avatar} initials={initials} className="avatar-xl" />
            {busy === 'avatar' && (
              <span className="avatar-busy" aria-hidden="true">
                <span className="spinner-border spinner-border-sm" />
              </span>
            )}
            <Dropdown
              align="start"
              buttonClassName="avatar-edit-btn"
              ariaLabel={t('profileMedia.changePhoto')}
              label={<i className="bi bi-camera-fill" aria-hidden="true" />}
            >
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => avatarInput.current?.click()}
                >
                  <i className="bi bi-upload me-2" aria-hidden="true" />
                  {t(images.hasAvatar ? 'profileMedia.changePhoto' : 'profileMedia.addPhoto')}
                </button>
              </li>
              {images.hasAvatar && (
                <li>
                  <button
                    type="button"
                    className="dropdown-item text-danger"
                    onClick={() => drop('avatar')}
                  >
                    <i className="bi bi-trash3 me-2" aria-hidden="true" />
                    {t('profileMedia.removePhoto')}
                  </button>
                </li>
              )}
            </Dropdown>
          </div>
          <div className="profile-identity__text flex-grow-1 min-vw-0">
            <h1 className="h4 fw-bold mb-1 truncate">{displayName}</h1>
            <div className="d-flex flex-wrap align-items-center gap-2">
              {user?.role && (
                <span className="badge text-bg-primary">
                  <i className="bi bi-shield-check me-1" aria-hidden="true" />
                  {localisedName(user.role, i18n.language)}
                </span>
              )}
              {user?.tenant && (
                <span className="badge text-bg-secondary">
                  <i className="bi bi-buildings me-1" aria-hidden="true" />
                  {localisedName(user.tenant, i18n.language)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-12 col-lg-5 d-flex flex-column gap-4">
          {/* ── Account details ─────────────────────────────────────────── */}
          <Panel title={<Title icon="person-vcard" text={t('auth.accountDetails')} />}>
            <InfoRow icon="person" label={t('users.fullName')} value={user?.fullName} />
            <InfoRow
              icon="envelope"
              label={t('users.email')}
              value={<span dir="ltr">{user?.email}</span>}
            />
            <InfoRow
              icon="shield-lock"
              label={t('users.role')}
              value={user?.role ? localisedName(user.role, i18n.language) : null}
            />
            <InfoRow
              icon="buildings"
              label={t('nav.company')}
              value={user?.tenant ? localisedName(user.tenant, i18n.language) : null}
            />
            <InfoRow
              icon="key"
              label={t('roles.permissions')}
              value={t('auth.permissionsCount', { count: user?.permissions?.length ?? 0 })}
            />
          </Panel>

          {/* ── Preferences ─────────────────────────────────────────────── */}
          <Panel title={<Title icon="sliders" text={t('auth.preferences')} />}>
            <div className="mb-3">
              <div className="form-label small fw-semibold">{t('app.language')}</div>
              <div className="segmented w-100" role="group" aria-label={t('app.language')}>
                {Object.values(LANGUAGES).map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    className={`flex-fill ${i18n.language === language.code ? 'active' : ''}`}
                    aria-pressed={i18n.language === language.code}
                    onClick={() => setLanguage(language.code)}
                  >
                    {language.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="form-label small fw-semibold">{t('theme.label')}</div>
              <div className="segmented w-100" role="group" aria-label={t('theme.label')}>
                {THEME_PREFERENCES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`flex-fill ${preference === option ? 'active' : ''}`}
                    aria-pressed={preference === option}
                    onClick={() => setThemePreference(option)}
                  >
                    <i className={`bi bi-${THEME_ICONS[option]} me-1`} aria-hidden="true" />
                    {t(`theme.${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Password ──────────────────────────────────────────────────── */}
        <div className="col-12 col-lg-7">
          <Panel title={<Title icon="lock" text={t('auth.changePassword')} />}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                changePassword.mutate();
              }}
            >
              <PasswordField
                id="currentPassword"
                label={t('auth.currentPassword')}
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={setField('currentPassword')}
                visible={visible}
              />
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <PasswordField
                    id="newPassword"
                    label={t('auth.newPassword')}
                    autoComplete="new-password"
                    value={passwords.newPassword}
                    onChange={setField('newPassword')}
                    visible={visible}
                  />
                </div>
                <div className="col-12 col-md-6">
                  <PasswordField
                    id="confirmPassword"
                    label={t('auth.confirmPassword')}
                    autoComplete="new-password"
                    value={passwords.confirmPassword}
                    onChange={setField('confirmPassword')}
                    visible={visible}
                    invalid={mismatch}
                    feedback={t('auth.passwordMismatch')}
                  />
                </div>
              </div>

              <div className="form-check mb-3">
                <input
                  id="showPasswords"
                  type="checkbox"
                  className="form-check-input"
                  checked={visible}
                  onChange={(event) => setVisible(event.target.checked)}
                />
                <label className="form-check-label small" htmlFor="showPasswords">
                  {t('auth.showPassword')}
                </label>
              </div>

              <ul className="list-unstyled small password-rules d-flex flex-column gap-1 mb-3">
                <li className={longEnough ? 'ok' : ''}>
                  <i className={`bi bi-${longEnough ? 'check-circle-fill' : 'circle'}`} aria-hidden="true" />
                  {t('auth.ruleLength', { count: MIN_PASSWORD_LENGTH })}
                </li>
                <li className={matches ? 'ok' : ''}>
                  <i className={`bi bi-${matches ? 'check-circle-fill' : 'circle'}`} aria-hidden="true" />
                  {t('auth.ruleMatch')}
                </li>
              </ul>

              <div className="alert alert-info d-flex gap-2 small py-2 px-3">
                <i className="bi bi-info-circle" aria-hidden="true" />
                <span>{t('auth.passwordHint')}</span>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  !passwords.currentPassword ||
                  !longEnough ||
                  !matches ||
                  changePassword.isPending
                }
              >
                {changePassword.isPending && (
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                )}
                {t('auth.changePassword')}
              </button>
            </form>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Title({ icon, text }) {
  return (
    <span className="d-inline-flex align-items-center gap-2">
      <span className="panel-icon" aria-hidden="true">
        <i className={`bi bi-${icon}`} />
      </span>
      {text}
    </span>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="info-row">
      <span className="info-icon" aria-hidden="true">
        <i className={`bi bi-${icon}`} />
      </span>
      <div className="min-vw-0">
        <div className="small text-body-secondary">{label}</div>
        <div className="fw-medium text-break">
          {value ?? <span className="text-body-tertiary">—</span>}
        </div>
      </div>
    </div>
  );
}

function PasswordField({ id, label, autoComplete, value, onChange, visible, invalid, feedback }) {
  return (
    <div className="mb-3">
      <label className="form-label small fw-semibold" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        dir="ltr"
        autoComplete={autoComplete}
        className={`form-control ${invalid ? 'is-invalid' : ''}`}
        value={value}
        onChange={onChange}
      />
      {invalid && <div className="invalid-feedback">{feedback}</div>}
    </div>
  );
}
