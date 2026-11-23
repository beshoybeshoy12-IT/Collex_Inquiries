import axios from 'axios';
import { secure } from './storage';

/**
 * The API client.
 *
 * The address comes from EXPO_PUBLIC_API_URL at build time (see .env.example).
 * There is no production URL in the code: a build pointed at the wrong server
 * should fail loudly at sign-in, not quietly send an investigator's evidence
 * somewhere it was never meant to go.
 *
 * Same contract as the office client:
 *  - responses arrive as `{ success, data }` and are unwrapped here;
 *  - errors carry the server's bilingual message plus its extra keys
 *    (`problems`, `errorCode`), so a screen can show what to fix;
 *  - TOKEN REFRESH IS SINGLE-FLIGHT. A screen that fires four requests on an
 *    expired token must trigger one refresh; the others wait for it. Four
 *    parallel refreshes would rotate an already-rotated token, the server
 *    would read that as theft, and sign the investigator out of every device.
 */

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5100/api/v1').replace(
  /\/$/,
  '',
);

const ACCESS = 'collex-field-access';
const REFRESH = 'collex-field-refresh';

export const tokens = {
  access: () => secure.get(ACCESS),
  refresh: () => secure.get(REFRESH),
  async save({ accessToken, refreshToken }) {
    if (accessToken) await secure.set(ACCESS, accessToken);
    if (refreshToken) await secure.set(REFRESH, refreshToken);
  },
  async clear() {
    await secure.remove(ACCESS);
    await secure.remove(REFRESH);
  },
};

let onSessionLost = () => {};
/** Called when the refresh token is refused: the session is over. */
export function setSessionLostHandler(handler) {
  onSessionLost = handler;
}

const api = axios.create({ baseURL: API_URL, timeout: 30_000 });

api.interceptors.request.use(async (config) => {
  const token = await tokens.access();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;

async function refreshOnce() {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await tokens.refresh();
      if (!refreshToken) throw new Error('no refresh token');
      const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
      await tokens.save(data.data ?? data);
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && body.success === true && 'data' in body) {
      return { ...response, data: 'meta' in body ? { data: body.data, meta: body.meta } : body.data };
    }
    return response;
  },
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const url = original?.url ?? '';

    if (status === 401 && original && !original._retried && !url.includes('/auth/')) {
      original._retried = true;
      try {
        await refreshOnce();
        return api(original);
      } catch {
        await tokens.clear();
        onSessionLost();
      }
    }

    const body = error.response?.data;
    error.details = body ?? null;
    error.friendlyMessage =
      (Array.isArray(body?.message) ? body.message.join('\n') : body?.message) ||
      (error.code === 'ECONNABORTED' || !error.response ? 'NETWORK' : 'UNKNOWN');
    return Promise.reject(error);
  },
);

/**
 * Server messages arrive as "عربي - English". Pick the half for the current
 * language; anything else is returned as is.
 */
export function localiseServerMessage(message, language) {
  if (!message || typeof message !== 'string') return message;
  const parts = message.split(' - ');
  if (parts.length < 2) return message;
  return language === 'ar' ? parts[0] : parts.slice(1).join(' - ');
}

export default api;
