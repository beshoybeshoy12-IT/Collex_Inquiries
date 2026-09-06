import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../app/AuthContext';
import { setLanguage, LANGUAGES } from '../../i18n';
import { localiseServerMessage } from '../../services/api';
import Logo from '../../components/Logo';

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
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-body-tertiary p-3">
      <div className="w-100" style={{ maxWidth: 420 }}>
        <div className="text-center mb-4">
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-3 text-bg-primary mb-2"
            style={{ width: 48, height: 48 }}
            aria-hidden="true"
          >
            <Logo size={30} />
          </span>
          <h1 className="h4 mb-1">{t('app.name')}</h1>
          <p className="text-body-secondary small mb-0">{t('app.tagline')}</p>
        </div>

        <div className="card shadow-sm">
          <div className="card-body p-4">
            <h2 className="h6 mb-1">{t('auth.welcome')}</h2>
            <p className="text-body-secondary small mb-3">{t('auth.welcomeHint')}</p>

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

        <div className="text-center mt-3">
          <button
            type="button"
            className="btn btn-sm btn-link text-decoration-none"
            onClick={() => setLanguage(otherLanguage)}
          >
            {LANGUAGES[otherLanguage].name}
          </button>
        </div>
      </div>
    </div>
  );
}
