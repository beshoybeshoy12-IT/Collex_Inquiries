import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../context/request-context';

/**
 * Leases a named scheduled job to one instance.
 *
 * Ported from Collex System V1, including its posture: IT FAILS OPEN. If the
 * lease cannot be read or written — a missing migration, a database blip — the
 * job runs anyway. The reasoning is that the worst case of failing open is a
 * sweep running twice (every sweep here is idempotent, by construction), while
 * the worst case of failing closed is a scheduled job that silently never runs
 * again and nobody notices for a month.
 *
 * The lease is time-based rather than a lock: an instance that dies mid-job
 * does not hold the lease forever, it expires.
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);
  /** Identifies this process in the lease row, for debugging a stuck job. */
  private readonly instanceId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Run `fn` if this instance can take the lease.
   *
   * `leaseSeconds` should comfortably exceed the job's worst-case runtime: too
   * short and a second instance starts the job while the first is still going;
   * too long and a crashed instance blocks it for that period.
   */
  async runExclusive<T>(
    name: string,
    leaseSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const acquired = await this.acquire(name, leaseSeconds);
    if (!acquired) {
      this.logger.debug(`Job "${name}" is held by another instance; skipping`);
      return undefined;
    }

    try {
      return await fn();
    } finally {
      await this.release(name);
    }
  }

  private async acquire(name: string, leaseSeconds: number): Promise<boolean> {
    const now = new Date();
    const until = new Date(now.getTime() + leaseSeconds * 1000);

    try {
      return await this.requestContext.runAsSystem(async () => {
        // One statement, so two instances racing cannot both win: the WHERE
        // clause only matches a lease that is absent or expired, and Postgres
        // serialises the conflicting updates.
        const rows = await this.prisma.$queryRaw<{ name: string }[]>`
          INSERT INTO cron_locks ("name", "lockedUntil", "lockedBy", "updatedAt")
          VALUES (${name}, ${until}, ${this.instanceId}, ${now})
          ON CONFLICT ("name") DO UPDATE
            SET "lockedUntil" = ${until},
                "lockedBy"    = ${this.instanceId},
                "updatedAt"   = ${now}
            WHERE cron_locks."lockedUntil" < ${now}
          RETURNING "name"
        `;
        return rows.length > 0;
      }, 'cron-lock');
    } catch (error) {
      // Fail open. See the note at the top.
      this.logger.warn(
        `Could not read the lease for "${name}" (${String(error)}); running anyway`,
      );
      return true;
    }
  }

  private async release(name: string): Promise<void> {
    await this.requestContext
      .runAsSystem(() =>
        this.prisma.cronLock.updateMany({
          where: { name, lockedBy: this.instanceId },
          data: { lockedUntil: new Date() },
        }),
      )
      .catch(() => undefined);
  }
}
