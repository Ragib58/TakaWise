import request from 'supertest';
import type { App } from 'supertest/types';
import {
  BackgroundJobsService,
  JOB_SCHEDULES,
} from '../../src/modules/jobs/background-jobs.service';
import { createTestApp, type TestApp } from '../utils/create-test-app';

/** Redis used by integration tests (docker-compose: 6389; CI: service container). */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6389';

async function eventually<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('background jobs on BullMQ (ADR-014)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      REDIS_URL: TEST_REDIS_URL,
      WORKER_ENABLED: 'true',
      JOBS_PREFIX: `takawise-test-${process.pid}`,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the maintenance schedulers in Redis', async () => {
    const jobs = app.get(BackgroundJobsService);
    const ids = await eventually(
      () => jobs.schedulerIds(),
      (v) => v.length === JOB_SCHEDULES.length,
    );
    expect(ids).toEqual(JOB_SCHEDULES.map((s) => s.id).sort());
  });

  it('runs job handlers (idempotent sweeps)', async () => {
    const jobs = app.get(BackgroundJobsService);
    await expect(jobs.run('reminders.dispatch')).resolves.toHaveProperty('notified');
    await expect(jobs.run('idempotency.cleanup')).resolves.toHaveProperty('deleted');
  });

  it('reports Redis as up in readiness', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/health/ready')
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });
});

describe('readiness without Redis', () => {
  it('is "disabled" when no REDIS_URL is configured', async () => {
    const app = await createTestApp();
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/health/ready')
      .expect(200);
    expect(res.body.data.checks.redis).toBe('disabled');
    await app.close();
  });

  it('is "degraded" (still 200) when Redis is unreachable', async () => {
    const app = await createTestApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/health/ready')
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'degraded', checks: { redis: 'down' } });
    await app.close();
  });
});
