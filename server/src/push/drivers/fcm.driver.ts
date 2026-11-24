import { Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from '../../common/config/env';
import { PushDriver, PushMessage, PushResult } from '../push.driver';

/**
 * Firebase Cloud Messaging, HTTP v1 — talked to directly.
 *
 * NO EXPO PUSH SERVICE AND NO firebase-admin. The handset registers its raw
 * FCM token (`getDevicePushTokenAsync`), and this driver signs its own
 * service-account JWT with `node:crypto` and posts to Google. That is the whole
 * protocol: one OAuth exchange, cached for its hour, and one POST per message.
 * A 60 MB SDK for two HTTP calls is not a trade worth making.
 *
 * CREDENTIALS ARE NEVER IN THE REPOSITORY. Either point
 * `FCM_SERVICE_ACCOUNT_FILE` at the JSON Firebase gives you (kept outside the
 * repo), or set `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY`
 * (the form a container secret store prefers). `PUSH_DRIVER=fcm` with neither
 * refuses to boot — a push driver that is "on" and cannot authenticate would
 * fail on every notification, hours later, silently.
 */

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Parallel sends per batch. FCM's v1 API has no multicast; keep it polite. */
const CONCURRENCY = 10;

export function loadServiceAccount(): ServiceAccount {
  const file = env('FCM_SERVICE_ACCOUNT_FILE');

  if (file) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    } catch (error) {
      throw new Error(
        `FCM_SERVICE_ACCOUNT_FILE could not be read as JSON: ${String(error)}`,
      );
    }
    return assertComplete({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    });
  }

  return assertComplete({
    projectId: env('FCM_PROJECT_ID'),
    clientEmail: env('FCM_CLIENT_EMAIL'),
    // Secret stores and .env files flatten newlines to a literal "\n".
    privateKey: env('FCM_PRIVATE_KEY').replace(/\\n/g, '\n'),
  });
}

function assertComplete(account: ServiceAccount): ServiceAccount {
  if (!account.projectId || !account.clientEmail || !account.privateKey) {
    throw new Error(
      'PUSH_DRIVER=fcm needs FCM_SERVICE_ACCOUNT_FILE, or all of ' +
        'FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY. See .env.example.',
    );
  }
  return account;
}

export class FcmPushDriver implements PushDriver {
  readonly name = 'fcm';
  readonly configured = true;

  private readonly logger = new Logger('FcmPushDriver');
  private accessToken: { value: string; expiresAt: number } | null = null;
  private inflightToken: Promise<string> | null = null;

  constructor(
    private readonly account: ServiceAccount = loadServiceAccount(),
    private readonly http: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      // Authentication failed for the whole batch. Every token is FAILED,
      // not UNREGISTERED — the handsets are fine, our credentials are not.
      const detail = `FCM authentication failed: ${String(error)}`;
      this.logger.error(detail);
      return messages.map((m) => ({
        token: m.token,
        outcome: 'FAILED',
        detail,
      }));
    }

    const results: PushResult[] = [];
    for (let i = 0; i < messages.length; i += CONCURRENCY) {
      const chunk = messages.slice(i, i + CONCURRENCY);
      results.push(
        ...(await Promise.all(chunk.map((m) => this.sendOne(m, token)))),
      );
    }
    return results;
  }

  private async sendOne(
    message: PushMessage,
    accessToken: string,
  ): Promise<PushResult> {
    const body = {
      message: {
        token: message.token,
        notification: { title: message.title, body: message.body },
        ...(message.data ? { data: message.data } : {}),
        android: {
          priority: message.highPriority ? 'HIGH' : 'NORMAL',
          // The channel the app creates at start-up (`default`).
          notification: { channel_id: 'default' },
        },
        apns: {
          headers: { 'apns-priority': message.highPriority ? '10' : '5' },
        },
      },
    };

    try {
      const response = await this.http(
        `https://fcm.googleapis.com/v1/projects/${this.account.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      if (response.ok) return { token: message.token, outcome: 'SENT' };

      const payload = (await response
        .json()
        .catch(() => null)) as FcmErrorBody | null;
      return {
        token: message.token,
        outcome: classifyFailure(response.status, payload),
        detail: `FCM ${response.status}: ${payload?.error?.message ?? response.statusText}`,
      };
    } catch (error) {
      return {
        token: message.token,
        outcome: 'FAILED',
        detail: `FCM request failed: ${String(error)}`,
      };
    }
  }

  /**
   * An OAuth access token, cached until a minute before it expires.
   * Single-flight, so a burst of notifications triggers one exchange.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    this.inflightToken ??= this.exchange().finally(() => {
      this.inflightToken = null;
    });
    return this.inflightToken;
  }

  private async exchange(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const unsigned =
      `${encode({ alg: 'RS256', typ: 'JWT' })}.` +
      encode({
        iss: this.account.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      });
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(this.account.privateKey)
      .toString('base64url');

    const response = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description ?? `HTTP ${response.status}`);
    }

    this.accessToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return payload.access_token;
  }
}

interface FcmErrorBody {
  error?: {
    message?: string;
    status?: string;
    details?: Array<{ '@type'?: string; errorCode?: string }>;
  };
}

/**
 * Which failures mean "stop using this token".
 *
 * Only the two FCM is explicit about: `UNREGISTERED` (app uninstalled, token
 * rotated) and an `INVALID_ARGUMENT` that names the token. Everything else —
 * quota, 5xx, a bad key on our side — is FAILED, because retiring a healthy
 * handset over our own fault would silence it until the app re-registers.
 */
export function classifyFailure(
  status: number,
  body: FcmErrorBody | null,
): 'UNREGISTERED' | 'FAILED' {
  const codes = (body?.error?.details ?? []).map((d) => d.errorCode);
  if (status === 404 || codes.includes('UNREGISTERED')) return 'UNREGISTERED';
  if (
    status === 400 &&
    codes.includes('INVALID_ARGUMENT') &&
    /registration token/i.test(body?.error?.message ?? '')
  ) {
    return 'UNREGISTERED';
  }
  return 'FAILED';
}
