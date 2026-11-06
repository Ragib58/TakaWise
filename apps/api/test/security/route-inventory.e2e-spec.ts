import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../utils/create-test-app';

/**
 * Phase 7 endpoint review, automated: enumerate EVERY registered route and
 * prove default-deny (ADR-013). Only the routes below may be reachable without
 * an access token; adding a new public route requires updating this list on
 * purpose (and the review table in docs/security/endpoint-review.md).
 */
const PUBLIC_ROUTES = new Set([
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/resend-verification',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  'GET /api/v1/metrics',
]);

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

function listRoutes(app: NestExpressApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as {
    router?: { stack: Layer[] };
    _router?: { stack: Layer[] };
  };
  const stack = (express.router ?? express._router)?.stack ?? [];
  const routes = new Set<string>();
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled && method !== '_all') routes.add(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return [...routes].sort();
}

describe('route inventory (default deny)', () => {
  let app: NestExpressApplication;
  let routes: string[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = listRoutes(app).filter((r) => r.includes('/api/v1/')); // excludes Swagger UI assets
  });

  afterAll(async () => {
    await app.close();
  });

  it('discovers the full API surface', () => {
    expect(routes.length).toBeGreaterThan(50);
    for (const pub of PUBLIC_ROUTES) expect(routes).toContain(pub);
  });

  it('rejects every non-public route without a token (401 before any handler runs)', async () => {
    const server = app.getHttpServer() as App;
    const failures: string[] = [];
    for (const route of routes) {
      if (PUBLIC_ROUTES.has(route)) continue;
      const [method, path] = route.split(' ') as [string, string];
      const url = path.replace(/:[A-Za-z]+/g, randomUUID());
      const res = await request(server)[method.toLowerCase() as 'get'](url).send({});
      if (res.status !== 401 || res.body?.error?.code !== 'UNAUTHENTICATED') {
        failures.push(`${route} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('rejects a forged token signed with another key', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwic2lkIjoieSIsInR5cCI6ImFjY2VzcyJ9.c2lnbmF0dXJlLWZyb20tYW5vdGhlci1rZXk';
    await request(app.getHttpServer() as App)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x","sid":"y","typ":"access"}').toString('base64url')}.`;
    await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${none}`)
      .expect(401);
  });
});
