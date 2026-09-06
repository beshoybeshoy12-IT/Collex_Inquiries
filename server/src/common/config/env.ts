import { Logger } from '@nestjs/common';

/**
 * Environment access with a single rule: anything the application cannot
 * behave correctly without throws at import time rather than failing later
 * under load.
 *
 * A missing storage credential that surfaces as a 500 on the first photo
 * upload — hours after deploy, to a field investigator standing outside a
 * customer's house — is strictly worse than a container that refuses to start.
 */

const logger = new Logger('Env');

/** Required. Throws at module load if missing or blank. */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Environment variable ${key} is missing or empty. See .env.example.`,
    );
  }
  return value;
}

/** Optional, with a default. */
export function env(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? fallback : value;
}

/**
 * A tuning knob. A typo must not stop the API from booting — fall back and say
 * so loudly. Contrast `requireDuration` below, where a wrong value is a
 * security bug rather than a performance one.
 */
export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(
      `${key}="${raw}" is not a positive integer — falling back to ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

export function envBool(key: string, fallback = false): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function envList(key: string, fallback: string[] = []): string[] {
  const raw = process.env[key];
  if (!raw || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A token lifetime, as a `jsonwebtoken` duration string ("15m", "7d").
 *
 * Unlike the pool knobs this refuses to fall back: a silently-wrong token
 * lifetime is a security bug, and an access token that lives for 7 days
 * because someone typed "15mm" is exactly the failure that never gets noticed.
 */
export function requireDuration(key: string, fallback: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  if (!/^\d+(ms|s|m|h|d|w|y)?$/.test(raw.trim())) {
    throw new Error(
      `Environment variable ${key}="${raw}" is not a valid duration. ` +
        `Use a plain number of seconds or a suffixed value such as 15m, 12h, 7d.`,
    );
  }
  return raw.trim();
}

export const isProduction = (): boolean =>
  process.env.NODE_ENV === 'production';

export const isTest = (): boolean => process.env.NODE_ENV === 'test';
