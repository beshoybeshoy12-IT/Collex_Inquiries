/**
 * Queue names and job payload shapes.
 *
 * Declared in one place because the producer lives in the API process and the
 * consumer lives in the worker: they never share a call site, so the only thing
 * keeping them in agreement is this file.
 */

export const QUEUES = {
  REPORTS: 'reports',
  EXPORTS: 'exports',
  NOTIFICATIONS: 'notifications',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  GENERATE_REPORT: 'generate-report',
  RUN_EXPORT: 'run-export',
  SEND_EMAIL: 'send-email',
  PRUNE_DATA: 'prune-data',
} as const;

export interface GenerateReportJob {
  tenantId: string;
  reportId: string;
  investigationId: string;
  requestedById?: string;
}

export interface RunExportJob {
  tenantId: string;
  exportJobId: string;
  requestedById?: string;
}

export interface SendEmailJob {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
}

export interface PruneDataJob {
  /** Which sweep to run. Kept as a string so a new sweep needs no enum change. */
  target: 'notifications' | 'audit' | 'exports' | 'gps' | 'tokens' | 'media';
  days?: number;
}

/**
 * Retry policy, shared by every queue.
 *
 * Three attempts with exponential backoff: a PDF render that fails because
 * Chromium was momentarily out of memory usually succeeds on the second try,
 * and one that fails because the template is broken will fail three times
 * quickly and land in the failed set where somebody can see it.
 *
 * `removeOnComplete` is bounded rather than true — keeping the last thousand
 * completions makes "did that report actually generate?" answerable without
 * keeping every job forever.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};
