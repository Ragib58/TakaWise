import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { ReminderDispatcher } from '../../src/modules/reminders/reminder-dispatcher.service';
import { connectTestDb } from '../db/fixtures';
import {
  type Api,
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  txnBody,
} from '../ledger/ledger-helpers';
import { createTestApp, type TestApp } from '../utils/create-test-app';

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe('categories, budgets, goals and reminders (API + DB)', () => {
  let app: TestApp;
  let prisma: PrismaClient;
  let food: string;
  let utilities: string;
  let electricity: string;
  let gas: string;
  let salary: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = connectTestDb();
    food = await categoryId(prisma, 'expense.food');
    utilities = await categoryId(prisma, 'expense.utilities');
    electricity = await categoryId(prisma, 'expense.utilities.electricity');
    gas = await categoryId(prisma, 'expense.utilities.gas');
    salary = await categoryId(prisma, 'income.salary');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ─────────────────────────────── Categories ───────────────────────────────

  describe('categories (CAT-01)', () => {
    let a: Api;
    let b: Api;

    beforeAll(async () => {
      ({ api: a } = await newUser(app));
      ({ api: b } = await newUser(app));
    });

    it('lists bilingual system categories plus only the user’s own', async () => {
      const created = await a
        .post('/categories', { type: 'EXPENSE', nameEn: 'Pets' }, null)
        .expect(201);
      expect(created.body.data).toMatchObject({ nameEn: 'Pets', nameBn: 'Pets', isSystem: false });

      const aList = (await a.get('/categories?type=EXPENSE').expect(200)).body.data as {
        id: string;
        nameBn: string;
        isSystem: boolean;
      }[];
      expect(aList.some((c) => c.id === created.body.data.id)).toBe(true);
      expect(aList.filter((c) => c.isSystem).every((c) => /[ঀ-৿]/.test(c.nameBn))).toBe(true);

      const bList = (await b.get('/categories').expect(200)).body.data as { id: string }[];
      expect(bList.some((c) => c.id === created.body.data.id)).toBe(false);
    });

    it('rejects duplicates, deep nesting and type mismatches', async () => {
      await a.post('/categories', { type: 'EXPENSE', nameEn: 'Hobbies' }, null).expect(201);
      expect(
        (await a.post('/categories', { type: 'EXPENSE', nameEn: 'hobbies' }, null).expect(409)).body
          .error.code,
      ).toBe('CONFLICT');

      const child = await a
        .post(
          '/categories',
          { type: 'EXPENSE', nameEn: 'Internet bill', parentId: utilities },
          null,
        )
        .expect(201);
      await a
        .post(
          '/categories',
          { type: 'EXPENSE', nameEn: 'Too deep', parentId: child.body.data.id },
          null,
        )
        .expect(400);
      await a
        .post('/categories', { type: 'INCOME', nameEn: 'Wrong parent', parentId: utilities }, null)
        .expect(400);
    });

    it('protects system categories and other users’ categories', async () => {
      expect(
        (await a.patch(`/categories/${food}`, { nameEn: 'Snacks' }).expect(403)).body.error.code,
      ).toBe('FORBIDDEN');
      const mine = await a
        .post('/categories', { type: 'EXPENSE', nameEn: 'Garden' }, null)
        .expect(201);
      await b.patch(`/categories/${mine.body.data.id}`, { nameEn: 'pwned' }).expect(404);
      await b.post(`/categories/${mine.body.data.id}/archive`, {}, null).expect(404);
    });

    it('an archived category cannot be used for new entries', async () => {
      const cat = await a
        .post('/categories', { type: 'EXPENSE', nameEn: 'Old habit' }, null)
        .expect(201);
      await a.post(`/categories/${cat.body.data.id}/archive`, {}, null).expect(200);
      const cash = (await createAccount(a, { openingBalance: '100' })).id;
      expect(
        (
          await a
            .post('/transactions', txnBody(cash, cat.body.data.id, { amount: '1' }))
            .expect(409)
        ).body.error.message,
      ).toMatch(/archived/);
      await a
        .post(
          '/budgets',
          { month: '2026-11', items: [{ categoryId: cat.body.data.id, amount: '10' }] },
          null,
        )
        .expect(400);
    });
  });

  // ─────────────────────────────── Budgets ───────────────────────────────

  describe('budgets (BUD-01, BUD-02)', () => {
    let api: Api;
    let budgetId: string;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      const cash = (
        await createAccount(api, { openingBalance: '50000', openingDate: '2026-09-01' })
      ).id;
      const bank = (await createAccount(api, { type: 'BANK', openingDate: '2026-09-01' })).id;
      const usd = (
        await createAccount(api, {
          name: 'USD',
          currency: 'USD',
          openingBalance: '500',
          openingDate: '2026-09-01',
        })
      ).id;
      const post = (body: object) => api.post('/transactions', body).expect(201);

      // Counted in November (Asia/Dhaka effective dates):
      await post(txnBody(cash, food, { amount: '1200', occurredAt: '2026-11-02T13:00:00+06:00' }));
      await post(txnBody(cash, food, { amount: '900', occurredAt: '2026-11-04T20:00:00+06:00' }));
      await post(
        txnBody(cash, electricity, { amount: '1500', occurredAt: '2026-11-03T10:00:00+06:00' }),
      );
      await post(txnBody(cash, gas, { amount: '800', occurredAt: '2026-11-03T11:00:00+06:00' }));
      // 2026-10-31T18:30Z is 1 Nov 00:30 in Dhaka → November.
      await post(txnBody(cash, food, { amount: '100', occurredAt: '2026-10-31T18:30:00Z' }));

      // NOT counted:
      // 31 Oct 23:59 in Dhaka → October.
      await post(txnBody(cash, food, { amount: '7000', occurredAt: '2026-10-31T17:59:00Z' }));
      // Reversed expense.
      const reversed = await post(
        txnBody(cash, food, { amount: '500', occurredAt: '2026-11-02T14:00:00+06:00' }),
      );
      await api.post(`/transactions/${reversed.body.data.id as string}/reverse`, {}).expect(200);
      // Income, transfer and another currency.
      await post(
        txnBody(bank, salary, {
          type: 'INCOME',
          amount: '80000',
          occurredAt: '2026-11-01T09:00:00+06:00',
        }),
      );
      await api
        .post('/transfers', {
          sourceAccountId: bank,
          destinationAccountId: cash,
          amount: '3000',
          currency: 'BDT',
          occurredAt: '2026-11-02T09:00:00+06:00',
        })
        .expect(201);
      await post(
        txnBody(usd, food, {
          amount: '20',
          currency: 'USD',
          occurredAt: '2026-11-02T09:00:00+06:00',
        }),
      );

      const created = await api
        .post(
          '/budgets',
          {
            month: '2026-11',
            overallAmount: '10000',
            items: [
              { categoryId: food, amount: '3000' },
              { categoryId: utilities, amount: '2000' },
            ],
          },
          null,
        )
        .expect(201);
      budgetId = created.body.data.id as string;
    });

    it('derives utilization only from posted expenses in the month, currency and category tree', async () => {
      const budget = (await api.get(`/budgets/${budgetId}`).expect(200)).body.data;
      expect(budget).toMatchObject({
        month: '2026-11',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        currency: 'BDT',
        totalSpent: '4500.0000',
        overall: {
          limit: '10000.0000',
          spent: '4500.0000',
          remaining: '5500.0000',
          percentUsed: '45.00',
          status: 'ok',
        },
      });
      const byCategory = Object.fromEntries(
        (budget.items as { category: { id: string } }[]).map((i) => [i.category.id, i]),
      );
      // Food: 1200 + 900 + 100 (boundary); excludes October 7000 and the reversed 500.
      expect(byCategory[food]).toMatchObject({
        spent: '2200.0000',
        remaining: '800.0000',
        percentUsed: '73.33',
        status: 'ok',
      });
      // Utilities includes its children: electricity 1500 + gas 800.
      expect(byCategory[utilities]).toMatchObject({
        spent: '2300.0000',
        remaining: '-300.0000',
        percentUsed: '115.00',
        status: 'over',
      });
    });

    it('reconciles with the ledger: totalSpent equals posted BDT expense journals in the period', async () => {
      const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
      const sum = await prisma.journalLine.aggregate({
        where: {
          currency: 'BDT',
          ledgerAccount: { userId: budget.userId, systemCode: 'EXPENSE' },
          journalEntry: { effectiveDate: { gte: budget.startDate, lte: budget.endDate } },
        },
        _sum: { debit: true, credit: true },
      });
      // Reversal journals carry the original date, so they net the reversed expense out.
      expect(sum._sum.debit!.minus(sum._sum.credit!).toFixed(4)).toBe('4500.0000');
    });

    it('allows one active budget per month and currency', async () => {
      expect(
        (await api.post('/budgets', { month: '2026-11', overallAmount: '1' }, null).expect(409))
          .body.error.code,
      ).toBe('CONFLICT');
      await api
        .post('/budgets', { month: '2026-11', currency: 'USD', overallAmount: '100' }, null)
        .expect(201);
    });

    it('validates input', async () => {
      await api.post('/budgets', { month: '2026-13', overallAmount: '1' }, null).expect(400);
      await api.post('/budgets', { month: '2026-10' }, null).expect(400);
      await api
        .post('/budgets', { month: '2026-10', items: [{ categoryId: salary, amount: '1' }] }, null)
        .expect(400);
      await api
        .post(
          '/budgets',
          {
            month: '2026-10',
            items: [
              { categoryId: food, amount: '1' },
              { categoryId: food, amount: '2' },
            ],
          },
          null,
        )
        .expect(400);
    });

    it('updates limits (replacing items) and recomputes', async () => {
      const res = await api
        .patch(`/budgets/${budgetId}`, { items: [{ categoryId: food, amount: '2000' }] })
        .expect(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({ spent: '2200.0000', status: 'over' });
      await api.patch(`/budgets/${budgetId}`, { overallAmount: null, items: [] }).expect(400);
    });

    it('archiving frees the month for a new budget; other users cannot see it', async () => {
      const { api: other } = await newUser(app);
      await other.get(`/budgets/${budgetId}`).expect(404);
      await other.patch(`/budgets/${budgetId}`, { name: 'x' }).expect(404);

      const october = await api
        .post('/budgets', { month: '2026-10', overallAmount: '5000' }, null)
        .expect(201);
      await api.post(`/budgets/${october.body.data.id as string}/archive`, {}, null).expect(200);
      await api.post('/budgets', { month: '2026-10', overallAmount: '6000' }, null).expect(201);
      const list = await api.get('/budgets?month=2026-10').expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].overall.spent).toBe('7000.0000');
    });
  });

  // ─────────────────────────────── Goals ───────────────────────────────

  describe('savings goals (GOAL-01, GOAL-02, ADR-009 earmark)', () => {
    let api: Api;
    let cash: string;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      cash = (await createAccount(api, { name: 'Savings box', openingBalance: '10000' })).id;
    });

    const contribute = (
      goalId: string,
      kind: 'CONTRIBUTION' | 'WITHDRAWAL',
      amount: string,
      key = randomUUID(),
    ) => api.post(`/goals/${goalId}/contributions`, { kind, amount }, key);

    it('cannot be linked to a credit card', async () => {
      const card = (await createAccount(api, { type: 'CREDIT_CARD_TRACKING' })).id;
      await api
        .post('/goals', { name: 'Bad', targetAmount: '100', linkedAccountId: card }, null)
        .expect(400);
    });

    it('derives progress from contributions, caps earmarks at the account balance, and achieves', async () => {
      const eid = (
        await api
          .post('/goals', { name: 'Eid', targetAmount: '8000', linkedAccountId: cash }, null)
          .expect(201)
      ).body.data;
      expect(eid).toMatchObject({
        saved: '0.0000',
        percent: '0.00',
        currency: 'BDT',
        status: 'ACTIVE',
      });

      const after = (await contribute(eid.id as string, 'CONTRIBUTION', '6000').expect(201)).body
        .data;
      expect(after).toMatchObject({ saved: '6000.0000', remaining: '2000.0000', percent: '75.00' });
      expect(after.linkedAccount).toMatchObject({ balance: '10000.0000', earmarked: '6000.0000' });
      expect(after.contributions).toHaveLength(1);

      const laptop = (
        await api
          .post('/goals', { name: 'Laptop', targetAmount: '50000', linkedAccountId: cash }, null)
          .expect(201)
      ).body.data;
      const capped = await contribute(laptop.id as string, 'CONTRIBUTION', '4000.01').expect(409);
      expect(capped.body.error.message).toMatch(/Only 4000\.0000 BDT/);
      await contribute(laptop.id as string, 'CONTRIBUTION', '4000').expect(201);

      await contribute(eid.id as string, 'WITHDRAWAL', '6000.01').expect(400);
      await contribute(eid.id as string, 'WITHDRAWAL', '1000').expect(201);
      // 1000 is free again; top Eid up to its 8000 target.
      const achieved = (await contribute(eid.id as string, 'CONTRIBUTION', '1000').expect(201)).body
        .data;
      expect(achieved.saved).toBe('6000.0000');
      const done =
        (await contribute(laptop.id as string, 'WITHDRAWAL', '3000').expect(201)) &&
        (await contribute(eid.id as string, 'CONTRIBUTION', '2000').expect(201)).body.data;
      expect(done).toMatchObject({ saved: '8000.0000', status: 'ACHIEVED', percent: '100.00' });
      expect(done.achievedAt).not.toBeNull();

      const user = await prisma.savingsGoal.findUniqueOrThrow({ where: { id: eid.id as string } });
      expect(
        await prisma.notification.count({ where: { userId: user.userId, kind: 'GOAL_ACHIEVED' } }),
      ).toBe(1);
    });

    it('corrections append a reversal; achievement follows history; no double reversal', async () => {
      const goal = (
        await api
          .post(
            '/goals',
            {
              name: 'Trip',
              targetAmount: '500',
              linkedAccountId: (await createAccount(api, { openingBalance: '1000' })).id,
            },
            null,
          )
          .expect(201)
      ).body.data;
      const posted = (await contribute(goal.id as string, 'CONTRIBUTION', '500').expect(201)).body
        .data;
      expect(posted.status).toBe('ACHIEVED');
      const entryId = (posted.contributions as { id: string }[])[0]!.id;

      const reversed = (
        await api
          .post(`/goals/${goal.id as string}/contributions/${entryId}/reverse`, {})
          .expect(200)
      ).body.data;
      expect(reversed).toMatchObject({ saved: '0.0000', status: 'ACTIVE', achievedAt: null });
      expect(
        (reversed.contributions as { kind: string; status: string }[]).map(
          (c) => `${c.kind}:${c.status}`,
        ),
      ).toEqual(['CONTRIBUTION:REVERSED', 'REVERSAL:POSTED']);
      await api
        .post(`/goals/${goal.id as string}/contributions/${entryId}/reverse`, {})
        .expect(409);
    });

    it('flags under-funding when the account balance later drops below the earmarks', async () => {
      const wallet = (
        await createAccount(api, { name: 'Nagad', type: 'MOBILE_WALLET', openingBalance: '2000' })
      ).id;
      const goal = (
        await api
          .post('/goals', { name: 'Phone', targetAmount: '5000', linkedAccountId: wallet }, null)
          .expect(201)
      ).body.data;
      await contribute(goal.id as string, 'CONTRIBUTION', '1500').expect(201);
      await api.post('/transactions', txnBody(wallet, food, { amount: '1000' })).expect(201);
      const res = (await api.get(`/goals/${goal.id as string}`).expect(200)).body.data;
      expect(res).toMatchObject({
        underFunded: true,
        saved: '1500.0000',
        linkedAccount: { balance: '1000.0000' },
      });
      expect(await balanceOf(api, wallet)).toBe('1000.0000'); // earmarks never move money
    });

    it('is idempotent and serialises concurrent contributions against the cap', async () => {
      const box = (await createAccount(api, { openingBalance: '4000' })).id;
      const goal = (
        await api
          .post('/goals', { name: 'Race', targetAmount: '100000', linkedAccountId: box }, null)
          .expect(201)
      ).body.data;
      const key = randomUUID();
      await contribute(goal.id as string, 'CONTRIBUTION', '100', key).expect(201);
      const replay = await contribute(goal.id as string, 'CONTRIBUTION', '100', key).expect(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');

      // 3900 free: of two parallel 3000 contributions exactly one may succeed.
      const results = await Promise.all(
        [1, 2].map(() => contribute(goal.id as string, 'CONTRIBUTION', '3000')),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const final = (await api.get(`/goals/${goal.id as string}`).expect(200)).body.data;
      expect(final.saved).toBe('3100.0000');
    });

    it('never lets the saved amount be edited directly, and isolates users', async () => {
      const goal = (
        await api
          .post('/goals', { name: 'Edit me', targetAmount: '100', linkedAccountId: cash }, null)
          .expect(201)
      ).body.data;
      await api.patch(`/goals/${goal.id as string}`, { saved: '100' }).expect(400);
      const { api: other } = await newUser(app);
      await other.get(`/goals/${goal.id as string}`).expect(404);
      await other
        .post(`/goals/${goal.id as string}/contributions`, { kind: 'CONTRIBUTION', amount: '1' })
        .expect(404);
      await other
        .post('/goals', { name: 'Steal', targetAmount: '1', linkedAccountId: cash }, null)
        .expect(404);
    });
  });

  // ─────────────────────────────── Reminders ───────────────────────────────

  describe('reminders and notifications (REM-01)', () => {
    let api: Api;
    let userId: string;
    let dispatcher: ReminderDispatcher;

    beforeAll(async () => {
      const user = await newUser(app);
      api = user.api;
      userId = (await prisma.user.findUniqueOrThrow({ where: { email: user.session.email } })).id;
      dispatcher = app.get(ReminderDispatcher);
    });

    it('stores UTC instants with the user’s time zone and local due date', async () => {
      const res = await api
        .post('/reminders', { title: 'Pay DESCO bill', dueAt: '2027-01-10T23:30:00+06:00' }, null)
        .expect(201);
      expect(res.body.data).toMatchObject({
        dueAt: '2027-01-10T17:30:00.000Z',
        timezone: 'Asia/Dhaka',
        dueDate: '2027-01-10',
        status: 'PENDING',
        pastDue: false,
      });
      await api
        .post('/reminders', { title: 'Too late', dueAt: '2020-01-01T00:00:00Z' }, null)
        .expect(400);
    });

    it('dispatches each due reminder exactly once, even with concurrent workers', async () => {
      const reminder = (
        await api
          .post('/reminders', { title: 'Internet bill', dueAt: inOneHour() }, null)
          .expect(201)
      ).body.data;
      // Simulate the passage of time.
      await prisma.reminder.update({
        where: { id: reminder.id as string },
        data: { createdAt: new Date(Date.now() - 7_200_000), dueAt: new Date(Date.now() - 60_000) },
      });

      await Promise.all([
        dispatcher.dispatchDue(),
        dispatcher.dispatchDue(),
        dispatcher.dispatchDue(),
      ]);
      await dispatcher.dispatchDue();

      const notifications = await prisma.notification.findMany({
        where: { userId, kind: 'REMINDER_DUE' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ title: 'Internet bill', readAt: null });

      const pastDue = await api.get('/reminders?view=past_due').expect(200);
      expect(
        (pastDue.body.data as { id: string; pastDue: boolean }[]).find((r) => r.id === reminder.id)
          ?.pastDue,
      ).toBe(true);

      // Rescheduling makes it notifiable again.
      await api.patch(`/reminders/${reminder.id as string}`, { dueAt: inOneHour() }).expect(200);
      expect(
        (await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id as string } }))
          .notifiedAt,
      ).toBeNull();
    });

    it('completes and cancels with clear state rules', async () => {
      const r = (
        await api.post('/reminders', { title: 'Rent', dueAt: inOneHour() }, null).expect(201)
      ).body.data;
      const done = await api.post(`/reminders/${r.id as string}/complete`, {}, null).expect(200);
      expect(done.body.data.status).toBe('DONE');
      expect(done.body.data.completedAt).not.toBeNull();
      await api.post(`/reminders/${r.id as string}/complete`, {}, null).expect(200);
      await api.post(`/reminders/${r.id as string}/cancel`, {}, null).expect(409);
      await api.patch(`/reminders/${r.id as string}`, { title: 'x' }).expect(409);
      const doneList = await api.get('/reminders?view=done').expect(200);
      expect((doneList.body.data as { id: string }[]).map((x) => x.id)).toContain(r.id);
    });

    it('lists and marks notifications read; other users cannot touch them', async () => {
      expect(
        (await api.get('/notifications/unread-count').expect(200)).body.data.unread,
      ).toBeGreaterThanOrEqual(1);
      const list = await api.get('/notifications?unread=true').expect(200);
      const first = (list.body.data as { id: string }[])[0]!;

      const { api: other } = await newUser(app);
      await other.post(`/notifications/${first.id}/read`, {}, null).expect(404);

      expect(
        (await api.post(`/notifications/${first.id}/read`, {}, null).expect(200)).body.data.readAt,
      ).not.toBeNull();
      await api.post('/notifications/read-all', {}, null).expect(200);
      expect((await api.get('/notifications/unread-count').expect(200)).body.data.unread).toBe(0);
    });

    it('isolates reminders between users', async () => {
      const r = (
        await api.post('/reminders', { title: 'Private', dueAt: inOneHour() }, null).expect(201)
      ).body.data;
      const { api: other } = await newUser(app);
      await other.get(`/reminders/${r.id as string}`).expect(404);
      await other.post(`/reminders/${r.id as string}/complete`, {}, null).expect(404);
    });
  });
});
