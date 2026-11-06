import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { sanitizeForLog } from '../../src/common/errors/all-exceptions.filter';
import { REDACT_PATHS } from '../../src/common/logging/logger.config';
import { loadConfig } from '../../src/config/env';
import { AccessTokenService } from '../../src/modules/auth/access-token.service';
import { createTestApp } from '../utils/create-test-app';
import { TEST_DATABASE_URL } from '../utils/test-database';

const OLD = 'old-signing-secret-0123456789abcdefghijkl';
const NEW = 'new-signing-secret-0123456789abcdefghijkl';
const config = (env: Record<string, string>) =>
  loadConfig({ DATABASE_URL: TEST_DATABASE_URL, AUTH_HMAC_SECRET: 'h'.repeat(40), ...env });

describe('JWT signing-key rotation (secret-rotation runbook)', () => {
  const jwt = new JwtService({});
  const tokenSignedWithOld = new AccessTokenService(jwt, config({ JWT_ACCESS_SECRET: OLD })).issue(
    'u1',
    's1',
  ).token;

  it('accepts tokens signed with JWT_ACCESS_SECRET_PREVIOUS during the window', () => {
    const rotated = new AccessTokenService(
      jwt,
      config({ JWT_ACCESS_SECRET: NEW, JWT_ACCESS_SECRET_PREVIOUS: OLD }),
    );
    expect(rotated.verify(tokenSignedWithOld)).toEqual({ userId: 'u1', sessionId: 's1' });
  });

  it('rejects them once the previous key is removed', () => {
    const after = new AccessTokenService(jwt, config({ JWT_ACCESS_SECRET: NEW }));
    expect(after.verify(tokenSignedWithOld)).toBeNull();
  });

  it('always signs with the current key', () => {
    const rotated = new AccessTokenService(
      jwt,
      config({ JWT_ACCESS_SECRET: NEW, JWT_ACCESS_SECRET_PREVIOUS: OLD }),
    );
    const fresh = rotated.issue('u2', 's2').token;
    expect(
      new AccessTokenService(jwt, config({ JWT_ACCESS_SECRET: NEW })).verify(fresh),
    ).not.toBeNull();
  });
});

describe('log redaction', () => {
  it('never logs Prisma error messages (they can echo query values)', () => {
    const prismaError = Object.assign(
      new Error('Invalid `prisma.transaction.create()` description: "salary from Karim"'),
      {
        name: 'PrismaClientValidationError',
        code: 'P2009',
        meta: { modelName: 'Transaction' },
      },
    );
    const logged = sanitizeForLog(prismaError);
    expect(JSON.stringify(logged)).not.toContain('Karim');
    expect(logged).toMatchObject({
      name: 'PrismaClientValidationError',
      code: 'P2009',
      model: 'Transaction',
    });
  });

  it('redacts credentials, tokens, codes and notes in structured logs', () => {
    for (const path of [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.refreshToken',
      '*.otp',
      '*.description',
      '*.notes',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});

describe('metrics endpoint', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('exposes Prometheus metrics labelled by route template (no ids)', async () => {
    app = await createTestApp();
    const server = app.getHttpServer() as App;
    await request(server).get('/api/v1/health').expect(200);
    await request(server).get(`/api/v1/accounts/0b6f6a64-3b8e-4e0a-9a4e-0f4f5c2e9b11`).expect(401);
    const res = await request(server).get('/api/v1/metrics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('takawise_http_request_duration_seconds_bucket');
    expect(res.text).toMatch(/route="\/api\/v1\/health"/);
    expect(res.text).not.toContain('0b6f6a64');
  });

  it('requires METRICS_TOKEN when configured, and is hidden in production without one', async () => {
    const token = 'm'.repeat(40);
    app = await createTestApp({ METRICS_TOKEN: token });
    await request(app.getHttpServer() as App)
      .get('/api/v1/metrics')
      .expect(401);
    await request(app.getHttpServer() as App)
      .get('/api/v1/metrics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await app.close();

    app = await createTestApp({
      NODE_ENV: 'production',
      SMTP_URL: 'smtp://x.invalid:25',
      REDIS_URL: 'redis://x.invalid:6379',
      WORKER_ENABLED: 'false',
    });
    await request(app.getHttpServer() as App)
      .get('/api/v1/metrics')
      .expect(404);
  });
});

describe('security headers', () => {
  let app: NestExpressApplication;

  afterAll(async () => {
    await app.close();
  });

  it('sends HSTS, nosniff, frame and referrer protections in production', async () => {
    app = await createTestApp({
      NODE_ENV: 'production',
      SMTP_URL: 'smtp://x.invalid:25',
      REDIS_URL: 'redis://x.invalid:6379',
      WORKER_ENABLED: 'false',
    });
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/health')
      .expect(200);
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
