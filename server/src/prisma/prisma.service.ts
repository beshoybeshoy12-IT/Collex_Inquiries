import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../common/context/request-context';
import { envInt, isProduction } from '../common/config/env';
import { tenantGuardExtension } from './tenant-guard';

/**
 * The connection pool is sized from the environment, not hardcoded.
 *
 * One replica holding 20 connections is fine; five replicas exhaust Postgres's
 * default `max_connections = 100` and the sixth container fails to connect.
 * Pool size and replica count have to be tunable independently — and an
 * operator who already spells the pool out in `DATABASE_URL` wins over both,
 * because appending a second `connection_limit` would leave Postgres taking
 * the first while the log line claimed the second.
 */
const DEFAULT_CONNECTION_LIMIT = 20;
const DEFAULT_POOL_TIMEOUT = 10;

function buildPooledUrl(): { url: string; description: string } {
  const raw = process.env.DATABASE_URL || '';

  let existing: URLSearchParams | null = null;
  try {
    existing = new URL(raw).searchParams;
  } catch {
    existing = null;
  }

  if (existing?.has('connection_limit')) {
    return {
      url: raw,
      description: `DATABASE_URL (connection_limit=${existing.get('connection_limit')})`,
    };
  }

  const connectionLimit = envInt(
    'DB_CONNECTION_LIMIT',
    DEFAULT_CONNECTION_LIMIT,
  );
  const poolTimeout = envInt('DB_POOL_TIMEOUT', DEFAULT_POOL_TIMEOUT);
  const separator = raw.includes('?') ? '&' : '?';

  return {
    url: `${raw}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`,
    description: `connection_limit=${connectionLimit}, pool_timeout=${poolTimeout}s`,
  };
}

/**
 * The database client every service injects.
 *
 * It is a `PrismaClient` with the tenant guard applied — see `tenant-guard.ts`
 * for what that does and why. The extension is attached in the constructor and
 * the extended client is returned in its place, so callers get the guarded
 * client from plain `PrismaService` injection and there is no second, unguarded
 * client anywhere in the process for someone to reach for by accident.
 *
 * The consequence of that trick is that Nest holds the *extended* object, not
 * an instance of this class — so a lifecycle hook written here would never be
 * called. Shutdown therefore lives in `PrismaModule`, which is a real class
 * Nest does call. Connection is lazy, so there is no startup hook to miss.
 */
@Injectable()
export class PrismaService extends PrismaClient {
  constructor(requestContext: RequestContextService) {
    const { url, description } = buildPooledUrl();

    super({
      datasources: { db: { url } },
      log: isProduction() ? ['error'] : ['warn', 'error'],
    });

    new Logger(PrismaService.name).log(`Prisma pool: ${description}`);

    // Returning from a constructor replaces the instance. Nest stores what
    // comes back, so every injection point receives the guarded client.
    return this.$extends(
      tenantGuardExtension({
        getContext: () => requestContext.get(),
        warnOnInjection: !isProduction(),
      }),
    ) as unknown as PrismaService;
  }
}
