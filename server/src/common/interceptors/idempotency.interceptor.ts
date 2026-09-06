import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, from, of, switchMap } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../context/request-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Idempotency-Key
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A field investigator submits a case from a stairwell. The request reaches
 *  the server, the server commits, and the reply is lost on the way back. The
 *  phone sees a timeout and retries.
 *
 *  Without this, that is two submissions. With it, the retry returns the first
 *  reply — same body, same status code — and nothing happens twice.
 *
 *  THE KEY IS CLAIMED BEFORE THE WORK RUNS, not recorded after it. Recording
 *  afterwards protects a *sequential* retry and does nothing for two requests
 *  in flight at once — which is precisely the case a double-tap on a phone
 *  with a slow connection produces. The row is inserted first with a sentinel
 *  status of 0; the primary key makes that insert the lock, so exactly one
 *  request proceeds and the other is told to wait.
 *
 *  THE KEY IS GENERATED WHEN THE USER ACTS, not when the request is sent. A
 *  key minted per HTTP attempt differs on the retry and buys nothing — the
 *  most common way this mechanism gets implemented uselessly. Said here and in
 *  `docs/mobile-api.md`.
 *
 *  SCOPE. Keys are namespaced by (tenant, principal, endpoint). One
 *  investigator's key cannot collide with another's, and the same key on a
 *  different endpoint is a different operation.
 *
 *  ONLY 2xx IS REPLAYED. A failure is not a completed operation; its claim is
 *  released so a retry genuinely re-runs. Replaying a 500 for a day would turn
 *  a transient blip into a permanent one for that key.
 *
 *  Opt-in: it costs a row per operation, and a web form whose result the user
 *  is watching does not need it.
 */

/** Sentinel status meaning "claimed, still running". */
const IN_FLIGHT = 0;

/** Long enough for a phone to find a signal; short enough to bound the table. */
const RETENTION_HOURS = 24;

/** How long a claim may sit unfinished before a retry may take it over. */
const STALE_CLAIM_MINUTES = 5;

const REPLAYABLE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const HEADER = 'idempotency-key';

/** The first request holding this key has not finished yet. */
export class IdempotencyInFlightError extends ConflictException {
  constructor() {
    super('الطلب قيد التنفيذ بالفعل - This request is already in progress');
  }
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const supplied = request.headers[HEADER];
    if (typeof supplied !== 'string' || supplied.length === 0) {
      return next.handle();
    }

    // A GET is idempotent already. Honouring the header there would cache a
    // read under a client-chosen key, which is a cache-poisoning primitive.
    if (!REPLAYABLE_METHODS.has(request.method)) return next.handle();

    if (supplied.length > 200) {
      throw new BadRequestException(
        'مفتاح التكرار طويل جدًا - Idempotency-Key is too long',
      );
    }

    const ctx = this.context.get();
    const tenantId = ctx?.tenantId;
    const principalId = ctx?.principalId;

    // An unauthenticated route has no principal to scope a key to, and a key
    // shared between callers is worse than none — one caller's retry would
    // replay another's response.
    if (!tenantId || !principalId) return next.handle();

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const key = `${tenantId}:${principalId}:${endpoint}:${supplied}`;

    return from(this.claim({ key, tenantId, principalId, endpoint })).pipe(
      switchMap((claim) => {
        if (claim.replay) {
          response.status(claim.replay.statusCode);
          response.setHeader('Idempotent-Replay', 'true');
          return of(claim.replay.response);
        }

        if (!claim.held) {
          // Could not claim and had nothing to replay — the lookup itself
          // failed. Proceed unprotected rather than refusing the work.
          return next.handle();
        }

        return next.handle().pipe(
          tap((body) => {
            void this.settle(key, response.statusCode, body);
          }),
          catchError((error) => {
            // The operation failed, so the claim must not stand — otherwise a
            // legitimate retry is locked out for five minutes by a failure.
            void this.release(key);
            throw error;
          }),
        );
      }),
    );
  }

  /**
   * Insert the claim, or discover why we cannot.
   *
   * Returns `{ replay }` when a finished response exists, `{ held: true }`
   * when this request owns the key, and throws when another request is still
   * working on it.
   */
  private async claim(entry: {
    key: string;
    tenantId: string;
    principalId: string;
    endpoint: string;
  }): Promise<{
    held: boolean;
    replay?: { statusCode: number; response: unknown };
  }> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: entry.key,
          tenantId: entry.tenantId,
          principalId: entry.principalId,
          endpoint: entry.endpoint,
          statusCode: IN_FLIGHT,
          response: {},
          expiresAt: new Date(Date.now() + RETENTION_HOURS * 3600_000),
        },
      });
      return { held: true };
    } catch {
      // The insert lost the race, or the key already existed. Either way the
      // existing row decides what happens next.
    }

    try {
      const row = await this.prisma.idempotencyKey.findUnique({
        where: { key: entry.key },
      });

      if (!row) return { held: false };

      if (row.expiresAt.getTime() <= Date.now()) {
        // Expired. Take it over rather than refusing — a client legitimately
        // reusing a key a day later should not be stuck.
        await this.prisma.idempotencyKey
          .update({
            where: { key: entry.key },
            data: {
              statusCode: IN_FLIGHT,
              response: {},
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + RETENTION_HOURS * 3600_000),
            },
          })
          .catch(() => undefined);
        return { held: true };
      }

      if (row.statusCode !== IN_FLIGHT) {
        return {
          held: false,
          replay: { statusCode: row.statusCode, response: row.response },
        };
      }

      // Still claimed. A claim older than the stale window belonged to a
      // process that died mid-request — nobody is going to settle it, and
      // holding the key forever would lock the client out permanently.
      const ageMinutes = (Date.now() - row.createdAt.getTime()) / 60_000;
      if (ageMinutes > STALE_CLAIM_MINUTES) {
        this.logger.warn(
          `taking over a stale idempotency claim on ${entry.endpoint}`,
        );
        return { held: true };
      }

      throw new IdempotencyInFlightError();
    } catch (error) {
      if (error instanceof IdempotencyInFlightError) throw error;

      // Idempotency is a safety net, not a dependency. A failed lookup lets
      // the request through: the worst case is the duplicate this was meant to
      // prevent, which beats refusing real work outright.
      this.logger.warn(
        `idempotency lookup failed, proceeding unprotected: ${String(error)}`,
      );
      return { held: false };
    }
  }

  /** Write the real response onto the claim, or drop it if it is not storable. */
  private async settle(
    key: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    // A stream has no JSON body to keep, and a download is not what this
    // protects — release rather than store an empty replay.
    if (body instanceof StreamableFile) return this.release(key);

    // Non-2xx never gets recorded. `settle` runs on the success path so this
    // is defensive, but a handler that sets its own 4xx status and returns a
    // body would otherwise be replayed for a day.
    if (statusCode < 200 || statusCode >= 300) return this.release(key);

    try {
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { statusCode, response: (body ?? null) as never },
      });
    } catch (error) {
      this.logger.warn(`idempotency settle failed: ${String(error)}`);
    }
  }

  /** Drop a claim so a retry may run the operation again. */
  private async release(key: string): Promise<void> {
    await this.prisma.idempotencyKey
      .delete({ where: { key } })
      .catch(() => undefined);
  }
}
