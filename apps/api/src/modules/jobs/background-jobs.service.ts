import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { sanitizeForLog } from '../../common/errors/all-exceptions.filter';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ReminderDispatcher } from '../reminders/reminder-dispatcher.service';

export const MAINTENANCE_QUEUE = 'takawise-maintenance';

export const JOB_SCHEDULES = [
  { id: 'reminders-dispatch', name: 'reminders.dispatch', everyMs: 60_000 },
  { id: 'idempotency-cleanup', name: 'idempotency.cleanup', everyMs: 60 * 60_000 },
] as const;

type JobName = (typeof JOB_SCHEDULES)[number]['name'];

/**
 * Background work (ADR-014) on BullMQ. Redis only coordinates *when* jobs run;
 * PostgreSQL stays the source of truth, and every handler is idempotent and safe
 * to run on several instances at once (e.g. SKIP LOCKED in the dispatcher).
 * Disabled with WORKER_ENABLED=false (tests) or when REDIS_URL is unset (dev).
 */
@Injectable()
export class BackgroundJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackgroundJobsService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reminders: ReminderDispatcher,
    private readonly idempotency: IdempotencyService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.WORKER_ENABLED) return;
    if (!this.config.REDIS_URL) {
      this.logger.warn('REDIS_URL is not set: background jobs (reminders, cleanup) are disabled');
      return;
    }
    // Never block startup on Redis; readiness reports it if unavailable.
    this.start(this.config.REDIS_URL).catch((err: unknown) => {
      this.logger.error({ err: sanitizeForLog(err) }, 'Failed to start background jobs');
    });
  }

  /** Registered scheduler ids (empty when jobs are disabled or not started yet). */
  async schedulerIds(): Promise<string[]> {
    if (!this.queue) return [];
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((s) => s.key).sort();
  }

  /** Stop taking jobs and let a running one finish before the database disconnects. */
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Executes one job by name; exported for tests and manual runs. */
  async run(name: JobName): Promise<Record<string, number>> {
    switch (name) {
      case 'reminders.dispatch':
        return this.reminders.dispatchDue();
      case 'idempotency.cleanup':
        return { deleted: await this.idempotency.purgeExpired() };
    }
  }

  private async start(url: string): Promise<void> {
    const connection: ConnectionOptions = { url, maxRetriesPerRequest: null };
    const prefix = this.config.JOBS_PREFIX;
    this.queue = new Queue(MAINTENANCE_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
    });
    for (const schedule of JOB_SCHEDULES) {
      await this.queue.upsertJobScheduler(
        schedule.id,
        { every: schedule.everyMs },
        { name: schedule.name },
      );
    }
    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => this.run(job.name as JobName), {
      connection,
      prefix,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error({ err: sanitizeForLog(err), job: job?.name }, 'Background job failed');
    });
    this.logger.log(`Background jobs started: ${JOB_SCHEDULES.map((s) => s.name).join(', ')}`);
  }
}
