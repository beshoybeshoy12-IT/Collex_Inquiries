import axios from 'axios';
import i18n from '../i18n';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The one HTTP client.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Always import this, never raw axios: the interceptors below are the only
 *  place that knows how to unwrap the response envelope, refresh an expired
 *  access token, and turn a server error into something a user can read. A
 *  second client would get none of it, and the difference would show up as one
 *  screen that logs people out while the rest silently recover.
 *
 *  THE REFRESH IS SINGLE-FLIGHT. A page that fires six requests as it loads
 *  will get six 401s within milliseconds of the access token expiring. Six
 *  concurrent refreshes would each rotate the token, and — because rotation
 *  treats a second use of a spent token as theft — five of them would be
 *  replays that revoke the entire session family. So the first 401 starts the
 *  refresh, the rest wait on that same promise, and everybody retries with the
 *  one new token.
 */

const TOKEN_KEY = 'collex-inq-token';
const REFRESH_KEY = 'collex-inq-refresh';
const USER_KEY = 'collex-inq-user';

export const tokenStore = {
  get access() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  get refresh() {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  get user() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set({ accessToken, refreshToken, user }) {
    try {
      if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // Private browsing. The session works for this tab and does not survive
      // a reload, which is the correct degradation.
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // So the server can render its own bilingual messages in the right language
  // rather than the client guessing which half of "AR - EN" to show.
  config.headers['Accept-Language'] = i18n.language || 'ar';
  return config;
});

/** The in-flight refresh, shared by every request that hits a 401 at once. */
let refreshInFlight = null;
let onSessionLost = null;

/** Let the auth layer decide what "signed out" looks like (redirect, modal). */
export function setSessionLostHandler(handler) {
  onSessionLost = handler;
}

async function refreshAccessToken() {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('no refresh token');

  // A bare axios call on purpose: routing this through `api` would recurse
  // into these same interceptors the moment the refresh itself 401s.
  const { data } = await axios.post(
    `${api.defaults.baseURL}/auth/refresh`,
    { refreshToken },
    { timeout: 15_000 },
  );

  const payload = data?.data ?? data;
  tokenStore.set({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  });
  return payload.accessToken;
}

api.interceptors.response.use(
  (response) => {
    // Unwrap `{ success, data, timestamp }` so callers get the payload.
    // A paginated reply carries `meta` as well, and both halves are kept —
    // `response.data` becomes `{ data, meta }`, which is what the table
    // components expect.
    const body = response.data;
    if (body && typeof body === 'object' && body.success === true) {
      if ('meta' in body) {
        return { ...response, data: { data: body.data, meta: body.meta } };
      }
      if ('data' in body) {
        return { ...response, data: body.data };
      }
    }
    return response;
  },

  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // ── Expired access token: refresh once, then replay the request ──────
    if (status === 401 && original && !original._retried) {
      // The refresh endpoint itself failing means the session is genuinely
      // gone; retrying it would loop.
      if (original.url?.includes('/auth/refresh') || !tokenStore.refresh) {
        tokenStore.clear();
        onSessionLost?.();
        return Promise.reject(decorate(error));
      }

      original._retried = true;

      try {
        refreshInFlight = refreshInFlight ?? refreshAccessToken();
        const token = await refreshInFlight;
        refreshInFlight = null;

        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshError) {
        refreshInFlight = null;
        tokenStore.clear();
        onSessionLost?.();
        return Promise.reject(decorate(error, refreshError));
      }
    }

    return Promise.reject(decorate(error));
  },
);

/**
 * Attach a message the UI can show, and keep the server's structured detail.
 *
 * The API returns `problems`, `reasons`, `tenants` and similar alongside the
 * message for exactly the cases where a sentence is not enough — a form that
 * failed on six fields, an email that matches two companies. Flattening the
 * error to a string here would throw all of that away.
 */
function decorate(error, cause) {
  const body = error.response?.data;
  const status = error.response?.status;

  error.status = status;
  error.errorCode = body?.errorCode;
  error.details = body;
  error.cause = cause ?? error.cause;

  const t = i18n.t.bind(i18n);

  if (!error.response) {
    error.friendlyMessage =
      error.code === 'ECONNABORTED' ? t('errors.timeout') : t('errors.network');
    error.isNetworkError = true;
    return error;
  }

  // `message` is a string, or the array `ValidationPipe` produces.
  const serverMessage = Array.isArray(body?.message)
    ? body.message.join('\n')
    : body?.message;

  if (serverMessage) {
    error.friendlyMessage = serverMessage;
    return error;
  }

  error.friendlyMessage =
    {
      400: t('errors.validation'),
      401: t('errors.unauthorized'),
      403: t('errors.forbidden'),
      404: t('errors.notFound'),
      409: t('errors.conflict'),
      500: t('errors.server'),
    }[status] ?? t('errors.unknown');

  return error;
}

/**
 * A bilingual server message, reduced to the half the user reads.
 *
 * The API answers in `"عربي - English"` so a message is legible whatever the
 * caller's language. On screen only one half belongs.
 */
export function localiseServerMessage(message, language = i18n.language) {
  if (typeof message !== 'string') return message;

  const parts = message.split(' - ');
  if (parts.length !== 2) return message;

  const [first, second] = parts;
  const firstIsArabic = /[؀-ۿ]/.test(first);

  if (language === 'ar') return firstIsArabic ? first : second;
  return firstIsArabic ? second : first;
}

export default api;
