import { randomUUID } from 'node:crypto';
import type {
  AdminUserResponse,
  BillingStatusResponse,
  CheckoutResponse,
  SharedResource,
  TicketResponse,
  WorkspaceDetail,
} from '@takawise/contracts';
import request from 'supertest';
import { signPayload } from '../../src/domain/saas/signatures';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { server } from '../auth/auth-helpers';
import { connectTestDb } from '../db/fixtures';
import { type Api, createAccount, newUser } from '../ledger/ledger-helpers';
import { createTestApp, type TestApp } from '../utils/create-test-app';

/**
 * Phase 10 (ADR-025/026/027) through the real API and database: server-side
 * entitlements, signed idempotent webhooks, the admin route group's role
 * boundaries, support tickets, and family workspaces where nothing is visible
 * unless shared and removal ends access immediately.
 */

const SECRET = 'test-payment-webhook-secret-0123456789abcdef';
const now = () => Math.floor(Date.now() / 1000);

describe('subscriptions, family and admin (API + DB)', () => {
  let app: TestApp;
  let prisma: PrismaClient;
  let admin: Api;
  let adminId: string;

  async function user() {
    const { api, session } = await newUser(app);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: session.email } });
    return { api, id: row.id, email: session.email };
  }

  async function staff(role: 'ADMIN' | 'SUPPORT') {
    const u = await user();
    await prisma.user.update({ where: { id: u.id }, data: { platformRole: role } });
    return u;
  }

  const billing = async (api: Api) =>
    (await api.get('/billing').expect(200)).body.data as BillingStatusResponse;

  const webhook = (body: object, header?: string) => {
    const raw = JSON.stringify(body);
    const req = request(server(app))
      .post('/api/v1/billing/webhooks/fake')
      .set('Content-Type', 'application/json');
    return (
      header === undefined
        ? req.set('takawise-signature', signPayload(SECRET, raw, now()))
        : req.set('takawise-signature', header)
    ).send(raw);
  };

  beforeAll(async () => {
    app = await createTestApp({ PAYMENT_PROVIDER: 'fake', PAYMENT_PROVIDER_SECRET: SECRET });
    prisma = connectTestDb();
    const a = await staff('ADMIN');
    admin = a.api;
    adminId = a.id;
    // Prices are an admin decision: make PRO and FAMILY purchasable for this suite.
    await admin.patch('/admin/plans/PRO', { priceAmount: '299', active: true }).expect(200);
    await admin.patch('/admin/plans/FAMILY', { priceAmount: '499', active: true }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('entitlements', () => {
    it('starts on FREE and blocks the 11th everyday account until upgraded', async () => {
      const { api, id } = await user();
      const status = await billing(api);
      expect(status.plan.code).toBe('FREE');
      expect(status.subscription).toBeNull();
      expect(status.entitlements).toMatchObject({ maxAccounts: 10, receiptOcr: false });

      for (let i = 0; i < 10; i++) await createAccount(api, { name: `Acc ${i}` });
      expect((await billing(api)).usage.accounts).toBe(10);
      const blocked = await api
        .post('/accounts', {
          name: 'Eleven',
          type: 'CASH',
          currency: 'BDT',
          openingBalance: '0',
          openingDate: '2026-11-01',
        })
        .expect(403);
      expect(blocked.body.error.code).toBe('PLAN_REQUIRED');
      expect(blocked.body.error.details[0].field).toBe('accounts');

      await admin
        .post(`/admin/users/${id}/subscription`, { planCode: 'PRO', months: 1 }, null)
        .expect(201);
      await createAccount(api, { name: 'Eleven' });
      expect((await billing(api)).entitlements.maxAccounts).toBeNull();
    });
  });

  describe('billing', () => {
    it('refuses checkout for FREE, unknown or inactive plans', async () => {
      const { api } = await user();
      await api.post('/billing/checkout', { planCode: 'FREE' }, null).expect(400);
      await api.post('/billing/checkout', { planCode: 'GOLD' }, null).expect(400);
    });

    it('activates only through a correctly signed webhook, exactly once', async () => {
      const { api, id } = await user();
      const checkout = (await api.post('/billing/checkout', { planCode: 'PRO' }, null).expect(201))
        .body.data as CheckoutResponse;
      expect(checkout.url).toContain(checkout.checkoutId);
      expect((await billing(api)).plan.code).toBe('FREE');

      const event = {
        id: `evt_${randomUUID()}`,
        type: 'checkout.completed',
        data: { checkoutId: checkout.checkoutId, subscriptionId: `sub_${randomUUID()}` },
      };
      const raw = JSON.stringify(event);
      expect((await webhook(event, 't=1,v1=' + '0'.repeat(64))).status).toBe(401);
      expect(
        (await webhook(event, signPayload('wrong-secret-0123456789abcdefghijkl', raw, now())))
          .status,
      ).toBe(401);
      expect((await webhook(event, signPayload(SECRET, raw, now() - 600))).status).toBe(401);
      expect((await webhook(event, '')).status).toBe(401);
      expect(await prisma.paymentEvent.count({ where: { eventId: event.id } })).toBe(0);

      const ok = await webhook(event).expect(200);
      expect(ok.body.data).toMatchObject({ duplicate: false, outcome: 'activated' });
      const again = await webhook(event).expect(200);
      expect(again.body.data).toMatchObject({ duplicate: true });

      const status = await billing(api);
      expect(status.plan.code).toBe('PRO');
      expect(status.subscription).toMatchObject({ status: 'ACTIVE', provider: 'fake' });
      expect(await prisma.subscription.count({ where: { userId: id } })).toBe(1);
      expect(await prisma.paymentEvent.count({ where: { eventId: event.id } })).toBe(1);

      // A provider cancellation ends access; a later renewal for it is ignored.
      await webhook({
        id: `evt_${randomUUID()}`,
        type: 'subscription.canceled',
        data: { subscriptionId: event.data.subscriptionId },
      }).expect(200);
      expect((await billing(api)).plan.code).toBe('FREE');
      const late = await webhook({
        id: `evt_${randomUUID()}`,
        type: 'subscription.renewed',
        data: { subscriptionId: event.data.subscriptionId },
      }).expect(200);
      expect(late.body.data.outcome).toBe('not_live');
    });

    it('rejects webhooks for a provider that is not configured', async () => {
      await request(server(app)).post('/api/v1/billing/webhooks/sslcommerz').send({}).expect(404);
    });

    it('lets users complete only their own fake checkout and cancel at period end', async () => {
      const a = await user();
      const b = await user();
      const checkout = (
        await a.api.post('/billing/checkout', { planCode: 'PRO' }, null).expect(201)
      ).body.data as CheckoutResponse;
      await b.api.post(`/billing/fake/complete/${checkout.checkoutId}`, {}, null).expect(404);
      const done = (
        await a.api.post(`/billing/fake/complete/${checkout.checkoutId}`, {}, null).expect(200)
      ).body.data as BillingStatusResponse;
      expect(done.plan.code).toBe('PRO');

      const canceled = (await a.api.post('/billing/subscription/cancel', {}, null).expect(200)).body
        .data as BillingStatusResponse;
      expect(canceled.subscription?.cancelAtPeriodEnd).toBe(true);
      expect(canceled.plan.code).toBe('PRO');
    });

    it('keeps payment events append-only in the database', async () => {
      const row = await prisma.paymentEvent.findFirstOrThrow();
      await expect(
        prisma.paymentEvent.update({ where: { id: row.id }, data: { outcome: 'x' } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('admin route group', () => {
    it('denies customers and limits support staff', async () => {
      const { api } = await user();
      for (const path of ['/admin/me', '/admin/analytics', '/admin/plans', '/admin/tickets']) {
        expect((await api.get(path)).status).toBe(403);
      }
      const support = await staff('SUPPORT');
      expect((await support.api.get('/admin/me').expect(200)).body.data).toEqual({
        role: 'SUPPORT',
      });
      await support.api.get('/admin/tickets').expect(200);
      await support.api.get('/admin/plans').expect(403);
      await support.api.get('/admin/analytics').expect(403);
      await support.api.patch(`/admin/users/${adminId}/role`, { role: 'NONE' }).expect(403);
    });

    it('shows limited account metadata and aggregate analytics only', async () => {
      const target = await user();
      const acc = await createAccount(target.api, { name: 'Private', openingBalance: '123456' });
      const found = (
        await admin.get(`/admin/users?email=${encodeURIComponent(target.email)}`).expect(200)
      ).body.data as AdminUserResponse;
      expect(Object.keys(found).sort()).toEqual(
        [
          'createdAt',
          'email',
          'emailVerified',
          'id',
          'name',
          'platformRole',
          'status',
          'subscription',
        ].sort(),
      );
      const analytics = (await admin.get('/admin/analytics').expect(200)).body.data;
      expect(JSON.stringify(analytics)).not.toContain('123456');
      expect(analytics.users.total).toBeGreaterThan(0);
      // Staff status grants nothing over customers' financial records.
      await admin.get(`/accounts/${acc.id}`).expect(404);
    });

    it('changes roles with audit, never its own', async () => {
      const target = await user();
      await admin.patch(`/admin/users/${adminId}/role`, { role: 'NONE' }).expect(409);
      await admin.patch(`/admin/users/${target.id}/role`, { role: 'SUPPORT' }).expect(200);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.role.changed', userId: target.id },
      });
      expect(log.actorId).toBe(adminId);
      await target.api.get('/admin/tickets').expect(200);
      await admin.patch(`/admin/users/${target.id}/role`, { role: 'NONE' }).expect(200);
      await target.api.get('/admin/tickets').expect(403);
    });

    it('validates plan edits', async () => {
      await admin.patch('/admin/plans/FREE', { active: false }).expect(400);
      await admin.patch('/admin/plans/PRO', { entitlements: { maxAccounts: 'many' } }).expect(400);
      await admin.patch('/admin/plans/NOPE', { active: true }).expect(404);
    });
  });

  describe('support tickets', () => {
    it('round-trips a ticket between a user and staff, private to its owner', async () => {
      const owner = await user();
      const other = await user();
      const support = await staff('SUPPORT');
      const ticket = (
        await owner.api
          .post(
            '/support/tickets',
            { subject: 'Cannot export', category: 'BUG', body: 'The CSV is empty' },
            null,
          )
          .expect(201)
      ).body.data as TicketResponse;
      await other.api.get(`/support/tickets/${ticket.id}`).expect(404);
      await support.api
        .post(`/admin/tickets/${ticket.id}/messages`, { body: 'Which month?' }, null)
        .expect(200);
      const seen = (await owner.api.get(`/support/tickets/${ticket.id}`).expect(200)).body
        .data as TicketResponse;
      expect(seen.status).toBe('PENDING_USER');
      expect(seen.messages.map((m) => m.fromStaff)).toEqual([false, true]);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'support.ticket.created', entityId: ticket.id },
      });
      expect(JSON.stringify(log.metadata ?? {})).not.toContain('CSV');
    });

    it('honours the admin kill switch immediately', async () => {
      const { api } = await user();
      await admin.patch('/admin/feature-flags/support.tickets', { enabled: false }).expect(200);
      try {
        const res = await api
          .post('/support/tickets', { subject: 'Hello', category: 'OTHER', body: 'x' }, null)
          .expect(403);
        expect(res.body.error.code).toBe('FEATURE_DISABLED');
        expect((await api.get('/features').expect(200)).body.data['support.tickets']).toBe(false);
      } finally {
        await admin.patch('/admin/feature-flags/support.tickets', { enabled: true }).expect(200);
      }
    });
  });

  describe('family workspaces', () => {
    const lastCode = (to: string) => {
      const mail = [...app.email.sent].reverse().find((m) => m.to === to);
      const code = /code: ([A-Z2-9]{10})/.exec(mail?.text ?? '')?.[1];
      if (!code) throw new Error(`no invite code for ${to}`);
      return code;
    };

    async function familyOwner() {
      const owner = await user();
      await admin
        .post(`/admin/users/${owner.id}/subscription`, { planCode: 'FAMILY', months: 1 }, null)
        .expect(201);
      const ws = (
        await owner.api.post('/family/workspaces', { name: 'Rahman family' }, null).expect(201)
      ).body.data as WorkspaceDetail;
      return { ...owner, ws };
    }

    it('needs a plan with family workspaces', async () => {
      const { api } = await user();
      const res = await api.post('/family/workspaces', { name: 'Us' }, null).expect(403);
      expect(res.body.error.code).toBe('PLAN_REQUIRED');
    });

    it('invites by e-mail code, bound to the invited address', async () => {
      const owner = await familyOwner();
      const member = await user();
      const stranger = await user();
      await owner.api
        .post(`/family/workspaces/${owner.ws.id}/invitations`, { email: member.email }, null)
        .expect(201);
      await owner.api
        .post(`/family/workspaces/${owner.ws.id}/invitations`, { email: member.email }, null)
        .expect(409);
      const code = lastCode(member.email);

      expect((await stranger.api.post('/family/invitations/accept', { code }, null)).status).toBe(
        400,
      );
      await stranger.api.get(`/family/workspaces/${owner.ws.id}`).expect(404);

      const joined = (
        await member.api.post('/family/invitations/accept', { code }, null).expect(200)
      ).body.data as WorkspaceDetail;
      expect(joined.myRole).toBe('MEMBER');
      expect(joined.members.map((m) => m.userId).sort()).toEqual([owner.id, member.id].sort());
      // Single use.
      expect((await member.api.post('/family/invitations/accept', { code }, null)).status).toBe(
        400,
      );

      // The owner's family plan covers the member.
      const covered = await billing(member.api);
      expect(covered.entitlements.receiptOcr).toBe(true);
      expect(covered.coveredBy).toBe('Rahman family');
      expect(covered.entitlements.familyWorkspace).toBe(false);
    });

    it('shows only what was shared, and removal ends access immediately', async () => {
      const owner = await familyOwner();
      const member = await user();
      await owner.api
        .post(`/family/workspaces/${owner.ws.id}/invitations`, { email: member.email }, null)
        .expect(201);
      await member.api
        .post('/family/invitations/accept', { code: lastCode(member.email) }, null)
        .expect(200);

      const shared = await createAccount(owner.api, {
        name: 'Household cash',
        openingBalance: '5000',
      });
      const privateAcc = await createAccount(owner.api, {
        name: 'My secret savings',
        openingBalance: '90000',
      });
      const goal = (
        await owner.api
          .post('/goals', { name: 'Eid', targetAmount: '20000', linkedAccountId: privateAcc.id })
          .expect(201)
      ).body.data as { id: string };

      const path = `/family/workspaces/${owner.ws.id}`;
      expect((await member.api.get(`${path}/shared`).expect(200)).body.data).toEqual([]);

      await owner.api
        .post(`${path}/shares`, { resourceType: 'ACCOUNT', resourceId: shared.id }, null)
        .expect(201);
      await owner.api
        .post(`${path}/shares`, { resourceType: 'GOAL', resourceId: goal.id }, null)
        .expect(201);
      await owner.api
        .post(`${path}/shares`, { resourceType: 'ACCOUNT', resourceId: shared.id }, null)
        .expect(409);
      // Nobody can share someone else's resource.
      await member.api
        .post(`${path}/shares`, { resourceType: 'ACCOUNT', resourceId: privateAcc.id }, null)
        .expect(404);

      const view = (await member.api.get(`${path}/shared`).expect(200)).body
        .data as SharedResource[];
      expect(view.map((v) => v.resourceType).sort()).toEqual(['ACCOUNT', 'GOAL']);
      const acc = view.find((v) => v.resourceType === 'ACCOUNT')!;
      expect(acc).toMatchObject({ name: 'Household cash', balance: '5000.0000' });
      const text = JSON.stringify(view);
      expect(text).not.toContain('My secret savings');
      expect(text).not.toContain('90000');
      await member.api.get(`/accounts/${privateAcc.id}`).expect(404);

      // Member shares their own account; owner sees it.
      const mine = await createAccount(member.api, {
        name: 'Member wallet',
        type: 'MOBILE_WALLET',
        openingBalance: '700',
      });
      await member.api
        .post(`${path}/shares`, { resourceType: 'ACCOUNT', resourceId: mine.id }, null)
        .expect(201);
      expect(
        ((await owner.api.get(`${path}/shared`).expect(200)).body.data as SharedResource[]).map(
          (v) => v.name,
        ),
      ).toContain('Member wallet');

      // Removal: no access for them, and their shares disappear for everyone.
      await owner.api.delete(`${path}/members/${member.id}`).expect(204);
      await member.api.get(path).expect(404);
      await member.api.get(`${path}/shared`).expect(404);
      expect(
        ((await owner.api.get(`${path}/shared`).expect(200)).body.data as SharedResource[]).map(
          (v) => v.name,
        ),
      ).not.toContain('Member wallet');
      expect((await billing(member.api)).coveredBy).toBeNull();
    });

    it('enforces roles: members cannot manage, the owner cannot leave', async () => {
      const owner = await familyOwner();
      const member = await user();
      const other = await user();
      await owner.api
        .post(`/family/workspaces/${owner.ws.id}/invitations`, { email: member.email }, null)
        .expect(201);
      await member.api
        .post('/family/invitations/accept', { code: lastCode(member.email) }, null)
        .expect(200);
      const path = `/family/workspaces/${owner.ws.id}`;
      await member.api.post(`${path}/invitations`, { email: other.email }, null).expect(403);
      await member.api.delete(`${path}/members/${owner.id}`).expect(409);
      await owner.api.delete(`${path}/members/${owner.id}`).expect(409);
      await member.api.delete(path).expect(403);
      // Leaving is always allowed.
      await member.api.delete(`${path}/members/${member.id}`).expect(204);
      await member.api.get(path).expect(404);
    });

    it('backs up share ownership in the database', async () => {
      const owner = await familyOwner();
      const victim = await user();
      const acc = await createAccount(victim.api, { name: 'Victim' });
      await expect(
        prisma.familyShare.create({
          data: {
            workspaceId: owner.ws.id,
            userId: owner.id,
            resourceType: 'ACCOUNT',
            resourceId: acc.id,
          },
        }),
      ).rejects.toThrow(/owned by the sharer/);
    });
  });
});
