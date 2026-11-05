import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { connectTestDb } from '../db/fixtures';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../utils/create-test-app';
import {
  bearer,
  cookieHeader,
  login,
  parseSetCookies,
  PASSWORD,
  refresh,
  registerAndVerify,
  server,
  sessionFrom,
  uniqueEmail,
} from './auth-helpers';

describe('authentication lifecycle (API + DB)', () => {
  let app: TestApp;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = connectTestDb();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('registration and email verification (AUTH-01, AUTH-02)', () => {
    it('registers a pending user with profile, system ledgers and an emailed code', async () => {
      const email = uniqueEmail();
      const res = await request(server(app))
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Rahima Begum',
          email: email.toUpperCase(),
          password: PASSWORD,
          acceptTerms: true,
          locale: 'bn',
        })
        .expect(202);
      expect(res.body.data).toEqual({ status: 'verification_required' });

      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { profile: true, ledgerAccounts: true },
      });
      expect(user.status).toBe('PENDING_VERIFICATION');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.profile).toMatchObject({
        fullName: 'Rahima Begum',
        locale: 'BN',
        timezone: 'Asia/Dhaka',
      });
      expect(user.ledgerAccounts.map((a) => a.systemCode).sort()).toEqual([
        'EQUITY_OPENING_BALANCE',
        'EXPENSE',
        'INCOME',
      ]);

      const message = app.email.sent.find((m) => m.to === email);
      expect(message?.subject).toMatch(/যাচাইকরণ কোড: \d{6}/); // Bangla template for locale bn
      const stored = await prisma.verificationToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(stored.codeHash).not.toContain(app.email.lastCode(email));
    });

    it('answers identically for an already-registered email (no enumeration)', async () => {
      const { email } = await registerAndVerify(app);
      const before = app.email.sent.length;
      const res = await request(server(app))
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Someone Else',
          email,
          password: 'another strong passphrase',
          acceptTerms: true,
        })
        .expect(202);
      expect(res.body.data).toEqual({ status: 'verification_required' });
      // The real owner gets a notice instead of a code.
      expect(app.email.sent.slice(before).map((m) => m.subject)).toEqual([
        'Someone tried to sign up with your email',
      ]);
    });

    it('rejects a weak password and a body that tries to set userId', async () => {
      const weak = await request(server(app))
        .post('/api/v1/auth/register')
        .send({ fullName: 'A', email: uniqueEmail(), password: 'password123', acceptTerms: true })
        .expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');

      const injected = await request(server(app))
        .post('/api/v1/auth/register')
        .send({
          fullName: 'A',
          email: uniqueEmail(),
          password: PASSWORD,
          acceptTerms: true,
          userId: 'x',
        })
        .expect(400);
      expect(injected.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('blocks login until the email is verified', async () => {
      const email = uniqueEmail();
      await request(server(app))
        .post('/api/v1/auth/register')
        .send({ fullName: 'Pending', email, password: PASSWORD, acceptTerms: true })
        .expect(202);
      const res = await request(server(app))
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('verifies with the right code, signs in, and makes the code single-use', async () => {
      const email = uniqueEmail();
      await request(server(app))
        .post('/api/v1/auth/register')
        .send({ fullName: 'Verify Me', email, password: PASSWORD, acceptTerms: true })
        .expect(202);
      const code = app.email.lastCode(email);

      const wrong = await request(server(app))
        .post('/api/v1/auth/verify-email')
        .send({ email, code: code === '000000' ? '111111' : '000000' })
        .expect(400);
      expect(wrong.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');

      const ok = await request(server(app))
        .post('/api/v1/auth/verify-email')
        .send({ email, code })
        .expect(200);
      expect(ok.body.data.user).toMatchObject({ email, emailVerified: true, status: 'ACTIVE' });

      const cookies = parseSetCookies(ok.headers);
      const rt = cookies.get('tw_rt');
      expect(rt?.attributes).toMatch(/HttpOnly/i);
      expect(rt?.attributes).toMatch(/SameSite=Strict/i);
      expect(rt?.attributes).toMatch(/Path=\/api\/v1\/auth/i);
      expect(cookies.get('tw_csrf')?.attributes).not.toMatch(/HttpOnly/i);

      await request(server(app))
        .post('/api/v1/auth/verify-email')
        .send({ email, code })
        .expect(400);
    });

    it('locks a code after 5 wrong attempts, even if the 6th guess is right', async () => {
      const email = uniqueEmail();
      await request(server(app))
        .post('/api/v1/auth/register')
        .send({ fullName: 'Brute Force', email, password: PASSWORD, acceptTerms: true })
        .expect(202);
      const code = app.email.lastCode(email);
      const wrong = code === '999999' ? '888888' : '999999';
      for (let i = 0; i < 5; i += 1) {
        await request(server(app))
          .post('/api/v1/auth/verify-email')
          .send({ email, code: wrong })
          .expect(400);
      }
      await request(server(app))
        .post('/api/v1/auth/verify-email')
        .send({ email, code })
        .expect(400);
    });

    it('rejects an expired code', async () => {
      const email = uniqueEmail();
      await request(server(app))
        .post('/api/v1/auth/register')
        .send({ fullName: 'Late', email, password: PASSWORD, acceptTerms: true })
        .expect(202);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.verificationToken.updateMany({
        where: { userId: user.id },
        data: {
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      await request(server(app))
        .post('/api/v1/auth/verify-email')
        .send({ email, code: app.email.lastCode(email) })
        .expect(400);
    });

    it('enforces the resend cooldown', async () => {
      const email = uniqueEmail();
      await request(server(app))
        .post('/api/v1/auth/register')
        .send({ fullName: 'Resend', email, password: PASSWORD, acceptTerms: true })
        .expect(202);
      const before = app.email.sent.filter((m) => m.to === email).length;
      await request(server(app))
        .post('/api/v1/auth/resend-verification')
        .send({ email })
        .expect(202);
      expect(app.email.sent.filter((m) => m.to === email)).toHaveLength(before);
    });
  });

  describe('login, access tokens and profile (AUTH-03, USER-01)', () => {
    it('returns the same error for a wrong password and an unknown email', async () => {
      const { email } = await registerAndVerify(app);
      const wrong = await request(server(app))
        .post('/api/v1/auth/login')
        .send({ email, password: 'not the password' })
        .expect(401);
      const unknown = await request(server(app))
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('ghost'), password: 'not the password' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.error).toMatchObject({
        code: wrong.body.error.code,
        message: wrong.body.error.message,
      });
    });

    it('protects /users/me and returns the profile for a valid token', async () => {
      const session = await registerAndVerify(app, uniqueEmail(), 'Nusrat Jahan');
      await request(server(app)).get('/api/v1/users/me').expect(401);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);

      const res = await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(session))
        .expect(200);
      expect(res.body.data).toMatchObject({
        email: session.email,
        profile: {
          fullName: 'Nusrat Jahan',
          locale: 'en',
          timezone: 'Asia/Dhaka',
          defaultCurrency: 'BDT',
        },
      });
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('updates profile preferences and validates them', async () => {
      const session = await registerAndVerify(app);
      const res = await request(server(app))
        .patch('/api/v1/users/me')
        .set('Authorization', bearer(session))
        .send({ locale: 'bn', timezone: 'Asia/Dhaka', fullName: 'নুসরাত জাহান' })
        .expect(200);
      expect(res.body.data.profile).toMatchObject({ locale: 'bn', fullName: 'নুসরাত জাহান' });

      await request(server(app))
        .patch('/api/v1/users/me')
        .set('Authorization', bearer(session))
        .send({ timezone: 'Mars/Base' })
        .expect(400);
      await request(server(app))
        .patch('/api/v1/users/me')
        .set('Authorization', bearer(session))
        .send({ userId: '00000000-0000-0000-0000-000000000000', fullName: 'X' })
        .expect(400);
    });
  });

  describe('refresh rotation and CSRF (ADR-011)', () => {
    it('requires the CSRF double-submit header and an allowlisted Origin', async () => {
      const session = await registerAndVerify(app);
      const missing = await request(server(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(session))
        .expect(403);
      expect(missing.body.error.code).toBe('CSRF_FAILED');

      await request(server(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(session))
        .set('X-CSRF-Token', 'forged')
        .expect(403);

      await request(server(app))
        .post('/api/v1/auth/refresh')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookieHeader(session))
        .set('X-CSRF-Token', session.csrfToken)
        .expect(403);

      await refresh(app, session).set('Origin', TEST_ORIGIN).expect(200);
    });

    it('rotates the refresh token on every use', async () => {
      const first = await registerAndVerify(app);
      const second = sessionFrom(await refresh(app, first).expect(200));
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).not.toBe(first.accessToken);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(second))
        .expect(200);
    });

    it('detects reuse of a rotated token and revokes the whole session family immediately', async () => {
      const original = await registerAndVerify(app);
      const rotated = sessionFrom(await refresh(app, original).expect(200));

      // Attacker replays the old (already rotated) refresh token.
      const replay = await refresh(app, original).expect(401);
      expect(replay.body.error.code).toBe('UNAUTHENTICATED');

      // The legitimate holder's newer tokens are revoked too.
      await refresh(app, rotated).expect(401);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(rotated))
        .expect(401);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: original.email } });
      expect(
        await prisma.auditLog.count({
          where: { userId: user.id, action: 'auth.refresh.reuse_detected' },
        }),
      ).toBe(1);
    });

    it('logout revokes the session and clears cookies', async () => {
      const session = await registerAndVerify(app);
      const res = await request(server(app))
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader(session))
        .set('X-CSRF-Token', session.csrfToken)
        .expect(200);
      expect(res.body.data).toEqual({ status: 'logged_out' });
      expect(parseSetCookies(res.headers).get('tw_rt')?.attributes).toMatch(
        /Expires=Thu, 01 Jan 1970/,
      );
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(session))
        .expect(401);
      await refresh(app, session).expect(401);
    });
  });

  describe('sessions (AUTH-03 session revocation)', () => {
    it('lists own sessions, revokes another own session, and hides other users’ sessions', async () => {
      const a1 = await registerAndVerify(app);
      const a2 = await login(app, a1.email);
      const b = await registerAndVerify(app);

      const list = await request(server(app))
        .get('/api/v1/auth/sessions')
        .set('Authorization', bearer(a1))
        .expect(200);
      const sessions = list.body.data as { id: string; current: boolean }[];
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      const otherOwn = sessions.find((s) => !s.current)!;

      const bSessions = await request(server(app))
        .get('/api/v1/auth/sessions')
        .set('Authorization', bearer(b))
        .expect(200);
      const bSessionId = (bSessions.body.data as { id: string }[])[0]!.id;

      // IDOR: A cannot revoke B's session, and gets a 404 (no existence leak).
      const idor = await request(server(app))
        .delete(`/api/v1/auth/sessions/${bSessionId}`)
        .set('Authorization', bearer(a1))
        .expect(404);
      expect(idor.body.error.code).toBe('NOT_FOUND');
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(b))
        .expect(200);

      await request(server(app))
        .delete(`/api/v1/auth/sessions/${otherOwn.id}`)
        .set('Authorization', bearer(a1))
        .expect(200);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(a2))
        .expect(401);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(a1))
        .expect(200);
    });

    it('logout-all revokes every session of the user only', async () => {
      const a1 = await registerAndVerify(app);
      const a2 = await login(app, a1.email);
      const b = await registerAndVerify(app);
      await request(server(app))
        .post('/api/v1/auth/logout-all')
        .set('Authorization', bearer(a1))
        .expect(200);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(a1))
        .expect(401);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(a2))
        .expect(401);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(b))
        .expect(200);
    });
  });

  describe('password reset and change', () => {
    it('answers identically for unknown emails', async () => {
      const before = app.email.sent.length;
      const res = await request(server(app))
        .post('/api/v1/auth/forgot-password')
        .send({ email: uniqueEmail('nobody') })
        .expect(202);
      expect(res.body.data).toEqual({ status: 'email_sent' });
      expect(app.email.sent.length).toBe(before);
    });

    it('resets the password, signs out all sessions, and keeps a weak attempt from burning the code', async () => {
      const session = await registerAndVerify(app);
      await request(server(app))
        .post('/api/v1/auth/forgot-password')
        .send({ email: session.email })
        .expect(202);
      const code = app.email.lastCode(session.email);

      const weak = await request(server(app))
        .post('/api/v1/auth/reset-password')
        .send({ email: session.email, code, newPassword: '12345678' })
        .expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');

      const newPassword = 'notun shokti passphrase 2026';
      await request(server(app))
        .post('/api/v1/auth/reset-password')
        .send({ email: session.email, code, newPassword })
        .expect(200);

      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(session))
        .expect(401);
      await request(server(app))
        .post('/api/v1/auth/login')
        .send({ email: session.email, password: PASSWORD })
        .expect(401);
      await login(app, session.email, newPassword);
      // Single use.
      await request(server(app))
        .post('/api/v1/auth/reset-password')
        .send({ email: session.email, code, newPassword: 'yet another passphrase' })
        .expect(400);
    });

    it('changes the password with the current one and signs out other sessions only', async () => {
      const current = await registerAndVerify(app);
      const other = await login(app, current.email);

      const wrong = await request(server(app))
        .post('/api/v1/users/me/password')
        .set('Authorization', bearer(current))
        .send({ currentPassword: 'wrong password', newPassword: 'brand new passphrase' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

      await request(server(app))
        .post('/api/v1/users/me/password')
        .set('Authorization', bearer(current))
        .send({ currentPassword: PASSWORD, newPassword: 'brand new passphrase' })
        .expect(200);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(current))
        .expect(200);
      await request(server(app))
        .get('/api/v1/users/me')
        .set('Authorization', bearer(other))
        .expect(401);
    });
  });

  describe('audit trail', () => {
    it('records security events without secrets', async () => {
      const session = await registerAndVerify(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: session.email } });
      const logs = await prisma.auditLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining([
          'auth.register',
          'auth.verification_code.sent',
          'auth.email_verified',
        ]),
      );
      const serialized = JSON.stringify(logs);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain(app.email.lastCode(session.email));
      expect(logs.every((l) => l.requestId)).toBe(true);
    });
  });
});

describe('rate limiting (AUTH-04)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ THROTTLE_ENABLED: 'true' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns RATE_LIMITED after too many login attempts from one client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await request(server(app))
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('rl'), password: 'whatever it is' });
      statuses.push(res.status);
      if (res.status === 429) expect(res.body.error.code).toBe('RATE_LIMITED');
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
