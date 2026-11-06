import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type TestApp } from '../utils/create-test-app';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6389';

const attemptLogin = (app: TestApp) =>
  request(app.getHttpServer() as App)
    .post('/api/v1/auth/login')
    .send({ email: `rl-${randomUUID()}@example.com`, password: 'whatever it is' });

describe('rate limiting shared through Redis (Phase 7)', () => {
  let a: TestApp;
  let b: TestApp;

  beforeAll(async () => {
    // Two API instances, one Redis: the login limit (10/min per client) is global.
    const env = {
      THROTTLE_ENABLED: 'true',
      REDIS_URL: TEST_REDIS_URL,
      JOBS_PREFIX: `rl-${randomUUID().slice(0, 8)}`,
    };
    a = await createTestApp(env);
    b = await createTestApp(env);
  });

  afterAll(async () => {
    await a.close();
    await b.close();
  });

  it('counts requests across instances', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await attemptLogin(i % 2 === 0 ? a : b)).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('rate limiting when Redis is unavailable', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ THROTTLE_ENABLED: 'true', REDIS_URL: 'redis://127.0.0.1:1' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps serving and falls back to a per-instance limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await attemptLogin(app)).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
