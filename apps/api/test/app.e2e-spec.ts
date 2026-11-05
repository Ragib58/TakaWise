import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorEnvelopeSchema,
  healthResponseSchema,
  paginatedEnvelopeSchema,
  successEnvelopeSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { Paginated } from '../src/common/envelope/paginated';
import { AppException } from '../src/common/errors/app.exception';
import { Public } from '../src/modules/auth/auth.decorators';
import { createTestApp, TEST_ORIGIN } from './utils/create-test-app';
import { UNREACHABLE_DATABASE_URL } from './utils/test-database';

class EchoDto extends createZodDto(
  z.object({
    name: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal string'),
  }),
) {}

/** Test-only routes that exercise the global pipeline. Never registered in the real app. */
@Public()
@Controller('__test')
class PipelineTestController {
  @Post('echo')
  echo(@Body() body: EchoDto) {
    return body;
  }

  @Get('paginated')
  paginated() {
    return new Paginated([{ id: 'a' }, { id: 'b' }], 2, 2, 5);
  }

  @Get('conflict')
  conflict(): never {
    throw new AppException('CONFLICT', 'Transaction is already reversed.', HttpStatus.CONFLICT);
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2');
  }
}

describe('API foundation (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;

  beforeAll(async () => {
    app = await createTestApp({}, { controllers: [PipelineTestController] });
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns the success envelope with a request ID', async () => {
      const res = await request(server).get('/api/v1/health').expect(200);

      const parsed = successEnvelopeSchema(healthResponseSchema).parse(res.body);
      expect(parsed.data.status).toBe('ok');
      expect(parsed.data.environment).toBe('test');
      expect(res.headers['x-request-id']).toBe(parsed.meta.requestId);
      expect(parsed.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('propagates a well-formed incoming X-Request-Id', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('X-Request-Id', 'client-trace-12345')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('client-trace-12345');
      expect(res.body.meta.requestId).toBe('client-trace-12345');
    });

    it('replaces a malformed incoming X-Request-Id', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('X-Request-Id', 'bad id <script>')
        .expect(200);
      expect(res.headers['x-request-id']).not.toBe('bad id <script>');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('is only served under the /api/v1 prefix', async () => {
      await request(server).get('/health').expect(404);
    });
  });

  describe('error envelope', () => {
    it('returns NOT_FOUND for unknown routes', async () => {
      const res = await request(server).get('/api/v1/does-not-exist').expect(404);
      const parsed = apiErrorEnvelopeSchema.parse(res.body);
      expect(parsed.error.code).toBe('NOT_FOUND');
      expect(parsed.error.requestId).toBe(res.headers['x-request-id']);
    });

    it('returns VALIDATION_ERROR with field details', async () => {
      const res = await request(server)
        .post('/api/v1/__test/echo')
        .send({ name: '', amount: '-5' })
        .expect(400);
      const parsed = apiErrorEnvelopeSchema.parse(res.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toBe('Please check the submitted fields.');
      expect(parsed.error.details.map((d) => d.field).sort()).toEqual(['amount', 'name']);
    });

    it('accepts a valid body and wraps it', async () => {
      const res = await request(server)
        .post('/api/v1/__test/echo')
        .send({ name: 'Lunch', amount: '450.00' })
        .expect(201);
      expect(res.body.data).toEqual({ name: 'Lunch', amount: '450.00' });
    });

    it('returns BAD_REQUEST for malformed JSON', async () => {
      const res = await request(server)
        .post('/api/v1/__test/echo')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);
      expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('BAD_REQUEST');
    });

    it('returns PAYLOAD_TOO_LARGE above the body limit', async () => {
      const res = await request(server)
        .post('/api/v1/__test/echo')
        .send({ name: 'x'.repeat(200 * 1024), amount: '1' })
        .expect(413);
      expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('passes through AppException code and message', async () => {
      const res = await request(server).get('/api/v1/__test/conflict').expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'Transaction is already reversed.',
      });
    });

    it('hides internal error messages', async () => {
      const res = await request(server).get('/api/v1/__test/boom').expect(500);
      const parsed = apiErrorEnvelopeSchema.parse(res.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });
  });

  it('builds the paginated envelope', async () => {
    const res = await request(server).get('/api/v1/__test/paginated').expect(200);
    const parsed = paginatedEnvelopeSchema(z.object({ id: z.string() })).parse(res.body);
    expect(parsed.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  });

  describe('security headers and CORS', () => {
    it('sets helmet headers and hides x-powered-by', async () => {
      const res = await request(server).get('/api/v1/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows an allowlisted origin with credentials', async () => {
      const res = await request(server)
        .options('/api/v1/health')
        .set('Origin', TEST_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,idempotency-key')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/i);
    });

    it('does not grant CORS to other origins', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('serves Swagger outside production', async () => {
    const res = await request(server).get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('TakaWise API');
    expect(Object.keys(res.body.paths)).toContain('/api/v1/health');
  });
});

describe('API foundation in production mode (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      NODE_ENV: 'production',
      SMTP_URL: 'smtp://unused.invalid:25',
      REDIS_URL: 'redis://unused.invalid:6379',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not expose Swagger', async () => {
    const server = app.getHttpServer() as App;
    await request(server).get('/api/docs').expect(404);
    await request(server).get('/api/docs-json').expect(404);
  });

  it('sends a Content-Security-Policy header', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/health')
      .expect(200);
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('readiness without a database (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ DATABASE_URL: UNREACHABLE_DATABASE_URL });
  });

  afterAll(async () => {
    await app.close();
  });

  it('liveness stays up while readiness reports SERVICE_UNAVAILABLE', async () => {
    const server = app.getHttpServer() as App;
    await request(server).get('/api/v1/health').expect(200);
    const res = await request(server).get('/api/v1/health/ready').expect(503);
    expect(apiErrorEnvelopeSchema.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
