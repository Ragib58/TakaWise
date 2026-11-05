import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { TestApp } from '../utils/create-test-app';

export const PASSWORD = 'amar sonar bangla 1971';

export const uniqueEmail = (tag = 'user') => `${tag}-${randomUUID()}@test.takawise.local`;

export type ParsedCookie = { value: string; attributes: string };

/** Parses Set-Cookie headers into name → { value, raw attributes }. */
export function parseSetCookies(headers: Record<string, unknown>): Map<string, ParsedCookie> {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const cookies = new Map<string, ParsedCookie>();
  for (const line of list) {
    const [pair = '', ...attrs] = line.split(';');
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index).trim(), {
      value: decodeURIComponent(pair.slice(index + 1)),
      attributes: attrs.join(';'),
    });
  }
  return cookies;
}

export type Session = { accessToken: string; refreshToken: string; csrfToken: string };

export function sessionFrom(res: request.Response): Session {
  const cookies = parseSetCookies(res.headers);
  const body = res.body as { data: { accessToken: string } };
  return {
    accessToken: body.data.accessToken,
    refreshToken: cookies.get('tw_rt')?.value ?? '',
    csrfToken: cookies.get('tw_csrf')?.value ?? '',
  };
}

export const server = (app: TestApp) => app.getHttpServer() as App;

export function cookieHeader(session: Pick<Session, 'refreshToken' | 'csrfToken'>): string {
  return `tw_rt=${encodeURIComponent(session.refreshToken)}; tw_csrf=${encodeURIComponent(session.csrfToken)}`;
}

/** POST /auth/refresh exactly like the web client does. */
export function refresh(app: TestApp, session: Pick<Session, 'refreshToken' | 'csrfToken'>) {
  return request(server(app))
    .post('/api/v1/auth/refresh')
    .set('Cookie', cookieHeader(session))
    .set('X-CSRF-Token', session.csrfToken);
}

export async function registerAndVerify(
  app: TestApp,
  email = uniqueEmail(),
  fullName = 'Karim Ahmed',
): Promise<Session & { email: string }> {
  await request(server(app))
    .post('/api/v1/auth/register')
    .send({ fullName, email, password: PASSWORD, acceptTerms: true })
    .expect(202);
  const res = await request(server(app))
    .post('/api/v1/auth/verify-email')
    .send({ email, code: app.email.lastCode(email) })
    .expect(200);
  return { ...sessionFrom(res), email };
}

export async function login(app: TestApp, email: string, password = PASSWORD): Promise<Session> {
  const res = await request(server(app))
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return sessionFrom(res);
}

export const bearer = (session: Pick<Session, 'accessToken'>) => `Bearer ${session.accessToken}`;
