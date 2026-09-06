import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronLockService } from './cron-lock.service';
import { SlaService } from '../../sla/sla.service';
import { AssignmentsService } from '../../assignments/assignments.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { GpsService } from '../../gps/gps.service';
import { MediaService } from '../../media/media.service';
import { TokenService } from '../../auth/token.service';
import { RequestContextService } from '../context/request-context';
import { env, envInt } from '../config/env';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Scheduled work.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  EVERY JOB HERE RUNS INSIDE `CronLockService.runExclusive`. At more than one
 *  replica, without that lease, every sweep runs once per replica — which for
 *  the escalation sweep means every coordinator gets three copies of every
 *  warning, and for the retention sweeps means three concurrent bulk deletes
 *  on the same table.
 *
 *  EVERY JOB IS IDEMPOTENT ANYWAY, because the lease fails open by design.
 *  Escalations deduplicate on a unique constraint; retention sweeps delete by
 *  age, so a second run finds nothing left to do.
 *
 *  Retention windows are environment variables, not constants: how long a
 *  collection agency must keep an audit trail is a legal question that differs
 *  by client contract, and it must not need a deploy to answer.
 */
@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private readonly locks: CronLockService,
    private readonly sla: SlaService,
    private readonly assignments: AssignmentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gps: GpsService,
    private readonly media: MediaService,
    private readonly tokens: TokenService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * SLA and escalation, every five minutes by default.
   *
   * The interval is a trade: shorter means a breach is noticed sooner, longer
   * means fewer full passes over the open case set. Five minutes is well inside
   * the granularity anybody acts on and cheap enough at realistic volumes.
   */
  @Cron(env('SLA_SWEEP_CRON', '*/5 * * * *'), { name: 'sla-sweep' })
  async slaSweep(): Promise<void> {
    await this.locks.runExclusive('sla-sweep', 240, async () => {
      const result = await this.sla.runEscalationSweep();
      if (result.escalationsFired > 0) {
        this.logger.log(
          `SLA sweep: ${result.escalationsFired} escalation(s) across ${result.tenantsChecked} tenant(s)`,
        );
      }
    });
  }

  /**
   * Assignment offers nobody answered, every ten minutes.
   *
   * Separate from the SLA sweep because it *changes case state* rather than
   * only notifying, and mixing the two would mean a slow escalation pass delays
   * cases returning to the queue.
   */
  @Cron('*/10 * * * *', { name: 'expire-assignments' })
  async expireStaleAssignments(): Promise<void> {
    await this.locks.runExclusive('expire-assignments', 540, async () => {
      await this.requestContext.runAsSystem(
        () => this.assignments.expireStaleOffers(),
        'assignment-sweep',
      );
    });
  }

  /**
   * Retention, nightly at 03:00.
   *
   * One job rather than five, because they all touch large tables and running
   * them concurrently is how a nightly sweep becomes a nightly outage. Each
   * failure is caught individually so one bad table does not stop the rest.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention-sweep' })
  async retentionSweep(): Promise<void> {
    await this.locks.runExclusive('retention-sweep', 3600, async () => {
      await this.requestContext.runAsSystem(async () => {
        const results: Record<string, number | string> = {};

        const run = async (label: string, fn: () => Promise<number>) => {
          try {
            results[label] = await fn();
          } catch (error) {
            results[label] = `failed: ${String(error)}`;
            this.logger.error(
              `Retention sweep "${label}" failed: ${String(error)}`,
            );
          }
        };

        await run('notifications', () =>
          this.notifications.pruneOlderThan(
            envInt('NOTIFICATION_RETENTION_DAYS', 90),
          ),
        );

        await run('audit', () =>
          this.audit.pruneOlderThan(envInt('AUDIT_RETENTION_DAYS', 730)),
        );

        // Only the every-minute breadcrumb trail. Check-ins are evidence and
        // are kept for as long as the case.
        await run('gpsLocationUpdates', () =>
          this.gps.pruneLocationUpdates(envInt('GPS_RETENTION_DAYS', 90)),
        );

        await run('abandonedUploads', () => this.media.prunePendingUploads(24));

        await run('expiredTokens', async () => {
          const pruned = await this.tokens.pruneExpired();
          return pruned.tokens + pruned.sessions;
        });

        this.logger.log(`Retention sweep complete: ${JSON.stringify(results)}`);
      }, 'retention-sweep');
    });
  }
}
