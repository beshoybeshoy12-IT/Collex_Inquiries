import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { QueueService } from './queue/queue.service';
import { ReportsService } from './reports/reports.service';
import { JOBS, QUEUES, GenerateReportJob } from './queue/queue.constants';
import { env } from './common/config/env';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The worker process.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  SAME IMAGE, SAME CODE, DIFFERENT ENTRY POINT. This boots the identical Nest
 *  application context the API does and pulls the same services out of it, then
 *  attaches BullMQ consumers. Two consequences worth being explicit about:
 *
 *   - There is exactly one implementation of report generation. A worker with
 *     its own copy is a worker that renders a different document from the one
 *     the API previews.
 *   - Every service the worker touches gets the same tenant guard, the same
 *     audit trail and the same notification pipeline. A background job cannot
 *     accidentally become a second, unguarded way into the database.
 *
 *  `createApplicationContext` rather than `create`: this process has no HTTP
 *  server, no controllers and no sockets. It listens to Redis and nothing else.
 *
 *  CONCURRENCY IS LOW ON PURPOSE. Each PDF render is a Chromium page holding
 *  tens of megabytes; four at once is already most of a small container's
 *  memory. Scale by adding worker containers, not by raising this number.
 */

const REPORT_CONCURRENCY = Number(env('REPORT_WORKER_CONCURRENCY', '2'));

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  const queue = app.get(QueueService);
  const reports = app.get(ReportsService);

  const connection = queue.getConnection();

  if (!connection) {
    // Without Redis there is nothing to consume: the API is running the same
    // jobs inline. Exiting cleanly is honest — a worker that sits idle looks
    // like it is working.
    logger.error(
      'REDIS_URL is not set, so there is no queue to consume. The API is ' +
        'running these jobs inline instead. Set REDIS_URL to run a worker.',
    );
    await app.close();
    process.exit(1);
  }

  const workers: Worker[] = [];

  workers.push(
    new Worker(
      QUEUES.REPORTS,
      async (job) => {
        if (job.name !== JOBS.GENERATE_REPORT) {
          logger.warn(
            `Unknown job "${job.name}" on the reports queue; ignoring`,
          );
          return;
        }
        return reports.generate(job.data as GenerateReportJob);
      },
      {
        connection,
        concurrency: REPORT_CONCURRENCY,
        // A render that has not finished in five minutes is stuck. Letting
        // BullMQ reclaim it is what stops one wedged job holding a slot
        // forever.
        lockDuration: 300_000,
      },
    ),
  );

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.error(
        `Job ${job?.name}#${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`,
      );
    });

    worker.on('completed', (job) => {
      logger.log(`Job ${job.name}#${job.id} completed`);
    });

    worker.on('error', (error) => {
      // Connection-level problems. Logged, not fatal: BullMQ reconnects.
      logger.error(`Worker error: ${error.message}`);
    });
  }

  logger.log(
    `Worker ready — consuming ${QUEUES.REPORTS} (concurrency ${REPORT_CONCURRENCY})`,
  );

  /**
   * Drain before exiting.
   *
   * `close()` lets in-flight jobs finish rather than abandoning them mid-render,
   * which would leave a report row stuck in GENERATING with no job behind it.
   */
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — finishing in-flight jobs`);
    await Promise.all(workers.map((worker) => worker.close()));
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
