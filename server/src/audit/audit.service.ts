import { Injectable, Logger } from '@nestjs/common';
import { AuditCategory, AuditSeverity, PrincipalType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context';

export interface AuditEntry {
  tenantId: string;
  /** A stable verb: CASE_ASSIGNED, USER_DISABLED, REPORT_GENERATED. */
  action: string;
  category: keyof typeof AuditCategory;
  severity?: keyof typeof AuditSeverity;

  actorType?: PrincipalType | null;
  actorId?: string | null;
  actorName?: string | null;

  entityType?: string;
  entityId?: string;
  entityLabel?: string;

  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;

  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The audit trail.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  FIRE AND FORGET, ALWAYS. `log()` swallows its own errors and returns void.
 *  An audit write must never be able to fail the operation it is recording —
 *  a full disk on the logging path must not stop a coordinator assigning work,
 *  and an exception thrown here would roll back the very transaction it was
 *  describing.
 *
 *  The trade is explicit: under failure this system loses audit rows rather
 *  than losing operations. That is the right way round for an operational
 *  platform, and the failure is logged where an operator will see it.
 *
 *  NO UPDATE, NO DELETE. This service exposes writes and reads and nothing
 *  else; `AuditController` is read-only. Rows age out through a dated retention
 *  sweep, never through a user action.
 *
 *  DIFFS, NOT ROWS. `diff()` reduces a before/after pair to the fields that
 *  actually changed. Storing whole rows would double every national id and
 *  home address in the database and make the log unreadable at the same time.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Record one event. Never throws.
   *
   * Not awaited by most callers — it is called inline after a mutation and the
   * caller returns without waiting. Awaiting it is also fine and is what the
   * tests do.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      const context = this.requestContext.get();

      // The write runs in the scope of the tenant the entry describes, which
      // is not always the ambient one. Sign-in is the case that proves it: the
      // audit row for a login attempt is written before the principal has been
      // established, so the ambient context is still unscoped and the tenant
      // guard — correctly — refuses to touch a tenant-scoped table. The entry
      // already carries the tenant it belongs to, so scoping to that is both
      // correct and the only value that could be written anyway.
      await this.requestContext.runAsTenant(
        entry.tenantId,
        () =>
          this.prisma.auditLog.create({
            data: {
              tenantId: entry.tenantId,
              action: entry.action,
              category: AuditCategory[entry.category],
              severity: AuditSeverity[entry.severity ?? 'INFO'],

              actorType: entry.actorType ?? context?.principalType ?? null,
              actorId: entry.actorId ?? context?.principalId ?? null,
              actorName: entry.actorName ?? context?.principalName ?? null,
              // Only a web user gets the FK; an investigator's id would violate it.
              userId:
                (entry.actorType ?? context?.principalType) ===
                PrincipalType.WEB_USER
                  ? (entry.actorId ?? context?.principalId ?? null)
                  : null,

              entityType: entry.entityType,
              entityId: entry.entityId,
              entityLabel: entry.entityLabel,

              oldValue: (entry.oldValue ?? undefined) as never,
              newValue: (entry.newValue ?? undefined) as never,

              ip: entry.ip ?? context?.ip,
              userAgent: entry.userAgent ?? context?.userAgent,
              requestId: context?.requestId,
              metadata: (entry.metadata ?? undefined) as never,
            },
          }),
        'audit',
      );
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${entry.action} on ${entry.entityType ?? '?'} ` +
          `${entry.entityId ?? ''}: ${String(error)}`,
      );
    }
  }

  /**
   * The changed fields only, as `{ before, after }` pairs.
   *
   * Keys present in `after` drive the comparison, so a partial update produces
   * a diff of exactly what the request touched. Dates and Decimals are
   * normalised to strings first, or every save would look like a change because
   * two equal `Date` objects are not `===`.
   */
  diff(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
  ): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    if (!after) return { oldValue, newValue };

    for (const [key, next] of Object.entries(after)) {
      const previous = before?.[key];
      if (!isEqual(previous, next)) {
        oldValue[key] = normalise(previous);
        newValue[key] = normalise(next);
      }
    }

    return { oldValue, newValue };
  }

  /**
   * Delete rows past the retention window.
   *
   * Pages through ids rather than issuing one unbounded DELETE: on the first
   * run after a two-year backlog a single statement would hold a lock on the
   * table for its whole duration, and this table is written to by every
   * mutation in the system.
   */
  async pruneOlderThan(days: number, batchSize = 1000): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let deleted = 0;

    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: batchSize,
      });
      if (batch.length === 0) break;

      const { count } = await this.prisma.auditLog.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      deleted += count;

      if (batch.length < batchSize) break;
    }

    return deleted;
  }
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimals and anything else with a meaningful toString.
  if (
    value &&
    typeof value === 'object' &&
    'toFixed' in (value as Record<string, unknown>)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value);
  }
  return value ?? null;
}

function isEqual(a: unknown, b: unknown): boolean {
  const left = normalise(a);
  const right = normalise(b);
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left === 'object' || typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}
