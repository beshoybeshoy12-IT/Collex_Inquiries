import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

/**
 * Hides a route from a user who cannot use it.
 *
 * THIS IS NOT A SECURITY CONTROL. Every permission it checks is enforced again
 * by the server on each request; this only stops a user reaching a screen that
 * would then fill with 403s. Anything that relies on this alone is a
 * vulnerability, which is why the message says "no permission" rather than
 * redirecting somewhere that might look like the feature does not exist.
 */
export default function ProtectedRoute({
  permissions = [],
  superAdmin = false,
  children,
}) {
  const { t } = useTranslation();
  const { can, user } = useAuth();

  /**
   * `superAdmin` is checked separately from `permissions`, and it has to be:
   * `can()` answers true for every permission a super admin is asked about, so
   * a platform route expressed as a permission would open to anybody a tenant
   * administrator chose to grant it to. The server gates these routes on
   * `isSuperAdmin` in code for the same reason.
   */
  const denied =
    (superAdmin && !user?.isSuperAdmin) ||
    (permissions.length > 0 && !can(...permissions));

  if (denied) {
    return (
      <div className="text-center py-5">
        <i
          className="bi bi-shield-lock text-body-tertiary"
          style={{ fontSize: '2.5rem' }}
          aria-hidden="true"
        />
        <p className="fw-semibold mt-3 mb-1">{t('errors.forbidden')}</p>
        <p className="text-body-secondary small mb-0">
          {superAdmin ? t('platform.operatorOnly') : t('users.cannotActOnPeer')}
        </p>
      </div>
    );
  }

  return children;
}
