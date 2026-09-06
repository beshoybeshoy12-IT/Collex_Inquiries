import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import api, { setSessionLostHandler, tokenStore } from '../services/api';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Who is signed in, and what they may do.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  THE PERMISSION LIST IS REFRESHED FROM THE SERVER ON EVERY BOOT, not read
 *  from the copy stored at sign-in. That snapshot goes stale the moment an
 *  administrator edits a role, and a UI gated on a stale list shows buttons
 *  that 403 — which is worse than not showing them, because the user has
 *  already decided to do the thing.
 *
 *  AND THE UI GATE IS ONLY A CONVENIENCE. `can()` hides what a user cannot do
 *  so the screen is honest; it is not a security control. Every one of these
 *  permissions is enforced again by `PermissionsGuard` on the server, which is
 *  the check that actually matters. Anything that relies on this alone is a
 *  vulnerability.
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => tokenStore.user);
  const [booting, setBooting] = useState(() => Boolean(tokenStore.access));

  const signOutLocally = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // The API layer calls this when a refresh fails — the session is gone and
  // there is nothing left to retry.
  useEffect(() => {
    setSessionLostHandler(() => signOutLocally());
  }, [signOutLocally]);

  // Re-resolve the principal on boot. Also validates the stored token: an
  // expired one is refreshed by the interceptor, and a revoked one signs out
  // here rather than on the user's first click.
  useEffect(() => {
    if (!tokenStore.access) {
      setBooting(false);
      return;
    }

    let cancelled = false;

    api
      .get('/auth/me')
      .then(({ data }) => {
        if (cancelled) return;
        // `/auth/me` returns the live principal, including permissions the
        // stored copy may no longer reflect.
        const merged = { ...tokenStore.user, ...data };
        tokenStore.set({ user: merged });
        setUser(merged);
      })
      .catch(() => {
        if (!cancelled) signOutLocally();
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signOutLocally]);

  /**
   * Keep tabs in step.
   *
   * Signing out in one tab must not leave another showing a live dashboard,
   * and signing in as somebody else must not leave the first tab holding the
   * previous user's screen.
   */
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === 'collex-inq-token' || event.key === 'collex-inq-user') {
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signIn = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    tokenStore.set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user,
    });
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    // Awaited: logout revokes the token server-side, and the request has to
    // land before the app tears down around it.
    await api.post('/auth/logout').catch(() => undefined);
    signOutLocally();
  }, [signOutLocally]);

  const value = useMemo(() => {
    const permissions = new Set(user?.permissions ?? []);
    const features = user?.tenant?.featureFlags ?? {};

    /** Does this user hold at least one of these permissions? */
    const can = (...required) => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return required.some((permission) => permissions.has(permission));
    };

    /**
     * Is a feature switched on for this company?
     *
     * An absent flag means enabled: a feature shipped after a tenant was
     * created must not switch itself off for them.
     */
    const featureEnabled = (feature) => features[feature] !== false;

    return {
      user,
      booting,
      isAuthenticated: Boolean(user),
      signIn,
      signOut,
      setUser,
      can,
      featureEnabled,
      permissions,
    };
  }, [user, booting, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
