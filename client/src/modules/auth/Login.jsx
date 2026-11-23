import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../app/AuthContext';
import { setLanguage, LANGUAGES } from '../../i18n';
import { localiseServerMessage } from '../../services/api';
import Logo, { Wordmark } from '../../components/Logo';
import ThemeToggle from '../../components/ThemeToggle';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantCode: z.string().optional(),
});

/**
 * Sign-in.
 *
 * Two behaviours worth pointing at:
 *
 *  - THE COMPANY CODE APPEARS ONLY WHEN IT IS NEEDED. Most people belong to one
 *    company and should never see the field. When an email matches two, the API
 *    answers 409 with the list, and the field appears pre-populated with a
 *    choice. Asking everybody for a code up front to handle the rare case is
 *    how a login form gets abandoned.
 *
 *  - THE LANGUAGE TOGGLE IS ON THIS SCREEN. It is the only page a signed-out
 *    user can reach, so it is the only place somebody who cannot read the
 *    default language can change it.
 */
export default function Login() {
  const { t, i18n } = useTranslation();
  const { signIn } = useAuth();

  const [error, setError] = useState(null);
  const [tenantChoices, setTenantChoices] = useState(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    setError(null);
    try {
      await signIn({
        email: values.email,
        password: values.password,
        ...(values.tenantCode ? { tenantCode: values.tenantCode } : {}),
      });
    } catch (submitError) {
      // The one case where the server is telling us to ask a further question
      // rather than reporting a failure.
      if (submitError.errorCode === 'TENANT_REQUIRED') {
        setTenantChoices(submitError.details?.tenants ?? []);
        setError(localiseServerMessage(submitError.friendlyMessage));
        return;
      }
      setError(localiseServerMessage(submitError.friendlyMessage));
    }
  };

  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <div className="auth-page">
      {/* The brand side. Hidden on phones, where the form is the whole job. */}
      <section className="auth-hero d-none d-lg-flex flex-column justify-content-between">
        {/* White on the blue hero: the artwork is single-colour, so contrast
            is set here rather than by a second asset. */}
        <div className="d-flex align-items-center gap-3 text-white">
          <Logo size={44} />
          <Wordmark height={22} title={t('app.name')} />
        </div>

        <div>
          <h2 className="mb-3">{t('auth.heroTitle')}</h2>
          <p className="mb-4">{t('auth.heroText')}</p>
          <div className="d-flex flex-column gap-3">
            {[
              ['geo-alt', 'auth.heroPoint1'],
              ['ui-checks', 'auth.heroPoint2'],
              ['shield-check', 'auth.heroPoint3'],
            ].map(([icon, key]) => (
              <div className="auth-feature" key={key}>
                <i className={`bi bi-${icon}`} aria-hidden="true" />
                <span className="pt-1">{t(key)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="small" style={{ color: 'rgba(255,255,255,.5)' }}>
          © {new Date().getFullYear()} {t('app.name')}
        </div>
      </section>

      <section className="auth-panel position-relative">
        <div className="position-absolute top-0 p-3" style={{ insetInlineEnd: 0 }}>
          <div className="header-tools">
            <button
              type="button"
              className="header-icon px-2"
              onClick={() => setLanguage(otherLanguage)}
            >
              <i className="bi bi-translate me-1" aria-hidden="true" />
              <span className="small fw-semibold">{LANGUAGES[otherLanguage].name}</span>
            </button>
            <ThemeToggle />
          </div>
        </div>

      <div className="auth-card">
        <div className="mb-4">
          <span className="brand-mark mb-3 d-lg-none" aria-hidden="true">
            <Logo size={34} />
          </span>
          <h1 className="h3 fw-bold mb-1">{t('auth.welcome')}</h1>
          <p className="text-body-secondary mb-0">{t('auth.welcomeHint')}</p>
        </div>

        <div className="card">
          <div className="card-body p-4">

            {error && (
              <div className="alert alert-danger py-2 px-3 small" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="mb-3">
                <label className="form-label small fw-semibold" htmlFor="email">
                  {t('auth.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  className={`form-control ${errors.email ? 'is-invalid' : ''}`}
                  {...register('email')}
                />
                {errors.email && (
                  <div className="invalid-feedback">{t('errors.validation')}</div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold" htmlFor="password">
                  {t('auth.password')}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                  {...register('password')}
                />
                {errors.password && (
                  <div className="invalid-feedback">{t('common.required')}</div>
                )}
              </div>

              {tenantChoices && (
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="tenantCode">
                    {t('auth.companyCode')}
                  </label>
                  {tenantChoices.length > 0 ? (
                    <select
                      id="tenantCode"
                      className="form-select"
                      {...register('tenantCode')}
                      onChange={(event) => setValue('tenantCode', event.target.value)}
                    >
                      <option value="">—</option>
                      {tenantChoices.map((tenant) => (
                        <option key={tenant.code} value={tenant.code}>
                          {i18n.language === 'ar' ? tenant.nameAr : tenant.nameEn} (
                          {tenant.code})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="tenantCode"
                      type="text"
                      dir="ltr"
                      className="form-control text-uppercase"
                      {...register('tenantCode')}
                    />
                  )}
                  <div className="form-text small">{t('auth.companyCodeHint')}</div>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-100"
                disabled={isSubmitting}
              >
                {isSubmitting && (
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    aria-hidden="true"
                  />
                )}
                {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-body-tertiary small mt-4 mb-0">{t('app.tagline')}</p>
      </div>
      </section>
    </div>
  );
}
