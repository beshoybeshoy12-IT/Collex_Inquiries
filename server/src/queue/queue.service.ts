import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import { env } from '../common/config/env';
import { DEFAULT_JOB_OPTIONS, QueueName, QUEUES } from './queue.constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Job dispatch.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  WITH REDIS: jobs go to BullMQ and a separate worker process consumes them.
 *  A 40-second PDF render never occupies the request loop.
 *
 *  WITHOUT REDIS: the queue falls back to INLINE mode. `enqueue` runs the
 *  handler in-process, awaited, inside the request that triggered it. This is a
 *  development convenience so `npm run start:local` works with nothing else
 *  installed — and it is announced at boot in a warning that says exactly what
 *  it costs, because a production deployment that ends up here by accident
 *  would have its API blocking on Chromium.
 *
 *  This is a documented degraded mode, not a pretend queue: inline execution
 *  really does run the work, and `isInline` is exposed so callers that must not
 *  run inline (a 200 MB export) can refuse instead.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  private readonly connection: Redis | null;
  private readonly queues = new Map<QueueName, Queue>();

  /** Handlers registered for inline mode. Empty in the API when Redis is up. */
  private readonly inlineHandlers = new Map<
    string,
    (payload: unknown) => Promise<unknown>
  >();

  constructor() {
    const url = env('REDIS_URL');

    if (!url) {
      this.connection = null;
      this.logger.warn(
        'REDIS_URL is not set — the job queue is running INLINE. Report ' +
          'generation, exports and maintenance sweeps will execute inside the ' +
          'request that triggers them, blocking it until they finish. This is ' +
          'for local development only; set REDIS_URL and run the worker ' +
          'process for anything else.',
      );
      return;
    }

    this.connection = new IORedis(url, {
      // BullMQ requires this; without it a blocking command that outlives a
      // reconnect throws instead of retrying.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.connection.on('error', (error) => {
      // Logged, not fatal: a Redis blip must not take the API down, and BullMQ
      // reconnects on its own.
      this.logger.error(`Redis connection error: ${error.message}`);
    });

    for (const name of Object.values(QUEUES)) {
      this.queues.set(
        name,
        new Queue(name, {
          connection: this.connection,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }),
      );
    }

    this.logger.log(
      `Queue ready on Redis (${Object.values(QUEUES).join(', ')})`,
    );
  }

  get isInline(): boolean {
    return this.connection === null;
  }

  /**
   * Whether the queue can actually take work right now.
   *
   * `isInline` answers a different question — whether Redis was CONFIGURED —
   * and a readiness probe that reports on that alone will happily say "queue:
   * redis" while Redis is down, because a configured-but-unreachable client is
   * still a non-null object. That is the failure this method exists to prevent:
   * an instance reporting a healthy queue while every job it accepts is
   * silently going nowhere.
   *
   * The PING is raced against a timeout because ioredis queues commands while
   * it is reconnecting, and an unbounded wait here would hang the probe rather
   * than fail it — which reads to an orchestrator as a healthy-but-slow
   * instance.
   */
  async ping(timeoutMs = 2_000): Promise<{ ok: boolean; detail: string }> {
    if (!this.connection) {
      return { ok: true, detail: 'inline (no Redis configured)' };
    }

    try {
      const reply = await Promise.race([
        this.connection.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs).unref(),
        ),
      ]);
      return reply === 'PONG'
        ? { ok: true, detail: 'redis' }
        : { ok: false, detail: `redis returned "${reply}"` };
    } catch (error) {
      return {
        ok: false,
        detail: `redis unreachable: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      };
    }
  }

  /**
   * Register the function inline mode calls for a job.
   *
   * Only used when there is no Redis. The worker process registers real BullMQ
   * processors instead — this map is never consulted there.
   */
  registerInlineHandler(
    jobName: string,
    handler: (payload: unknown) => Promise<unknown>,
  ): void {
    this.inlineHandlers.set(jobName, handler);
  }

  /**
   * Dispatch a job.
   *
   * Returns the job id when queued. In inline mode it returns null after the
   * work has already completed — callers that report "queued" to a user should
   * check `isInline` rather than assuming asynchrony.
   */
  async enqueue<T>(
    queue: QueueName,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string | null> {
    if (this.isInline) {
      const handler = this.inlineHandlers.get(jobName);
      if (!handler) {
        this.logger.error(
          `No inline handler registered for "${jobName}" and no Redis to queue it. ` +
            `The job was dropped.`,
        );
        return null;
      }

      this.logger.debug(`Running "${jobName}" inline`);
      await handler(payload);
      return null;
    }

    const job = await this.queues.get(queue)!.add(jobName, payload, options);
    return job.id ?? null;
  }

  /**
   * Schedule a repeating job.
   *
   * Only meaningful with Redis: inline mode has no scheduler, and the cron
   * decorators in the API process cover the same ground for a single-instance
   * development run.
   */
  async schedule<T>(
    queue: QueueName,
    jobName: string,
    payload: T,
    pattern: string,
  ): Promise<void> {
    if (this.isInline) {
      this.logger.debug(
        `Skipping schedule of "${jobName}" (${pattern}) — inline mode has no scheduler`,
      );
      return;
    }

    await this.queues.get(queue)!.add(jobName, payload, {
      repeat: { pattern },
      jobId: `repeat:${jobName}`,
    });
  }

  /** Depth and health, for the /health endpoint and the admin screen. */
  async stats(): Promise<
    Record<
      string,
      { waiting: number; active: number; failed: number; delayed: number }
    >
  > {
    if (this.isInline) return {};

    const out: Record<
      string,
      { waiting: number; active: number; failed: number; delayed: number }
    > = {};

    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'failed',
        'delayed',
      );
      out[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    }

    return out;
  }

  getConnection(): Redis | null {
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.connection?.quit().catch(() => undefined);
  }
}
