import { randomUUID } from 'node:crypto';
import { parseMoney } from '../../src/domain/money/money';
import type { PrismaService } from '../../src/database/prisma.service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { LedgerService, UnbalancedJournalError } from '../../src/modules/ledger/ledger.service';
import { connectTestDb } from '../db/fixtures';
import { createTestApp, type TestApp } from '../utils/create-test-app';
import {
  type Api,
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  systemLedgerBalance,
  txnBody,
} from './ledger-helpers';

describe('ledger, accounts, transactions and transfers (API + DB)', () => {
  let app: TestApp;
  let prisma: PrismaClient;
  let food: string;
  let salary: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = connectTestDb();
    food = await categoryId(prisma, 'expense.food');
    salary = await categoryId(prisma, 'income.salary');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('accounts (ACC-01, ACC-02)', () => {
    let api: Api;

    beforeAll(async () => {
      ({ api } = await newUser(app));
    });

    it('posts the opening balance as an OPENING_BALANCE journal', async () => {
      const account = await createAccount(api, { name: 'Wallet cash', openingBalance: '1000' });
      expect(account).toMatchObject({
        balance: '1000.0000',
        openingBalance: '1000.0000',
        balanceType: 'ASSET',
      });

      const ledger = await prisma.ledgerAccount.findUniqueOrThrow({
        where: { financialAccountId: account.id },
      });
      const lines = await prisma.journalLine.findMany({
        where: { ledgerAccountId: ledger.id },
        include: { journalEntry: true },
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]!.journalEntry.kind).toBe('OPENING_BALANCE');
      expect(lines[0]!.debit.toFixed(4)).toBe('1000.0000');
    });

    it('creates no journal for a zero opening balance', async () => {
      const account = await createAccount(api, { openingBalance: '0' });
      const ledger = await prisma.ledgerAccount.findUniqueOrThrow({
        where: { financialAccountId: account.id },
      });
      expect(await prisma.journalLine.count({ where: { ledgerAccountId: ledger.id } })).toBe(0);
    });

    it('tracks a credit card as a liability: opening balance is the amount owed', async () => {
      const card = await createAccount(api, {
        type: 'CREDIT_CARD_TRACKING',
        openingBalance: '2500',
      });
      expect(card).toMatchObject({ balance: '2500.0000', balanceType: 'LIABILITY' });
    });

    it('requires an Idempotency-Key and rejects invalid input', async () => {
      const body = { name: 'X', type: 'CASH', openingDate: '2026-01-01' };
      const noKey = await api.post('/accounts', body, null).expect(400);
      expect(noKey.body.error.details[0].field).toBe('Idempotency-Key');
      await api.post('/accounts', body, 'not-a-uuid').expect(400);
      await api.post('/accounts', { ...body, openingDate: '2999-01-01' }).expect(400);
      await api.post('/accounts', { ...body, openingBalance: '-5' }).expect(400);
      await api.post('/accounts', { ...body, creditLimit: '1000' }).expect(400);
      await api.post('/accounts', { ...body, userId: randomUUID() }).expect(400);
    });

    it('rejects a duplicate active name (case-insensitive) with 409', async () => {
      await createAccount(api, { name: 'City Bank Savings', type: 'BANK' });
      const res = await api
        .post('/accounts', { name: 'city bank savings', type: 'BANK', openingDate: '2026-01-01' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('renames but never changes financial fields; archives and restores', async () => {
      const account = await createAccount(api, { name: 'Old name' });
      const renamed = await api.patch(`/accounts/${account.id}`, { name: 'New name' }).expect(200);
      expect(renamed.body.data.name).toBe('New name');
      await api.patch(`/accounts/${account.id}`, { type: 'BANK' }).expect(400);
      await api.patch(`/accounts/${account.id}`, { openingBalance: '5' }).expect(400);

      await api.post(`/accounts/${account.id}/archive`, {}, null).expect(200);
      const active = await api.get('/accounts').expect(200);
      expect((active.body.data as { id: string }[]).map((a) => a.id)).not.toContain(account.id);
      const all = await api.get('/accounts?status=ALL').expect(200);
      expect((all.body.data as { id: string }[]).map((a) => a.id)).toContain(account.id);

      const restored = await api.post(`/accounts/${account.id}/restore`, {}, null).expect(200);
      expect(restored.body.data).toMatchObject({ status: 'ACTIVE', archivedAt: null });
    });
  });

  describe('income, expense and transfer posting (blueprint Phase 4 tests)', () => {
    let api: Api;
    let email: string;
    let cash: string;
    let bank: string;

    beforeAll(async () => {
      const user = await newUser(app);
      api = user.api;
      email = user.session.email;
      cash = (await createAccount(api, { name: 'Cash', openingBalance: '2000' })).id;
      bank = (await createAccount(api, { name: 'Bank', type: 'BANK' })).id;
    });

    it('salary increases the bank account', async () => {
      const res = await api
        .post(
          '/transactions',
          txnBody(bank, salary, {
            type: 'INCOME',
            amount: '50000',
            description: 'November salary',
          }),
        )
        .expect(201);
      expect(res.body.data).toMatchObject({
        type: 'INCOME',
        status: 'POSTED',
        amount: '50000.0000',
        accountBalance: '50000.0000',
      });
      expect(await balanceOf(api, bank)).toBe('50000.0000');
    });

    it('an expense decreases the cash account', async () => {
      await api.post('/transactions', txnBody(cash, food, { amount: '500' })).expect(201);
      expect(await balanceOf(api, cash)).toBe('1500.0000');
    });

    it('a transfer changes both accounts but not income or expense totals (TRX-03)', async () => {
      const incomeBefore = await systemLedgerBalance(prisma, email, 'INCOME');
      const expenseBefore = await systemLedgerBalance(prisma, email, 'EXPENSE');

      const res = await api
        .post('/transfers', {
          sourceAccountId: cash,
          destinationAccountId: bank,
          amount: '1000',
          currency: 'BDT',
          occurredAt: '2026-11-02T10:00:00+06:00',
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        status: 'POSTED',
        sourceAccount: { id: cash },
        destinationAccount: { id: bank },
      });

      expect(await balanceOf(api, cash)).toBe('500.0000');
      expect(await balanceOf(api, bank)).toBe('51000.0000');
      expect(await systemLedgerBalance(prisma, email, 'INCOME')).toBe(incomeBefore);
      expect(await systemLedgerBalance(prisma, email, 'EXPENSE')).toBe(expenseBefore);
    });

    it('a credit-card expense increases what is owed; a bank payment reduces it', async () => {
      const card = (await createAccount(api, { name: 'Visa', type: 'CREDIT_CARD_TRACKING' })).id;
      await api.post('/transactions', txnBody(card, food, { amount: '2000' })).expect(201);
      expect(await balanceOf(api, card)).toBe('2000.0000');

      const expenseBefore = await systemLedgerBalance(prisma, email, 'EXPENSE');
      await api
        .post('/transfers', {
          sourceAccountId: bank,
          destinationAccountId: card,
          amount: '1500',
          currency: 'BDT',
          occurredAt: '2026-11-03T10:00:00+06:00',
        })
        .expect(201);
      expect(await balanceOf(api, card)).toBe('500.0000');
      expect(await balanceOf(api, bank)).toBe('49500.0000');
      // The payment is not a second expense.
      expect(await systemLedgerBalance(prisma, email, 'EXPENSE')).toBe(expenseBefore);
    });

    it('derives the effective date in the user time zone (ADR-012)', async () => {
      const res = await api
        .post(
          '/transactions',
          txnBody(cash, food, { amount: '1', occurredAt: '2026-03-10T19:30:00Z' }),
        )
        .expect(201);
      expect(res.body.data.effectiveDate).toBe('2026-03-11');
    });

    it('rejects future dates, dates before the account opened, and currency mismatches', async () => {
      const late = new Date(Date.now() + 3 * 86_400_000).toISOString();
      expect(
        (await api.post('/transactions', txnBody(cash, food, { occurredAt: late })).expect(400))
          .body.error.details[0].field,
      ).toBe('occurredAt');
      await api
        .post('/transactions', txnBody(cash, food, { occurredAt: '2025-12-31T12:00:00+06:00' }))
        .expect(400);
      await api.post('/transactions', txnBody(cash, food, { currency: 'USD' })).expect(400);
    });

    it('rejects a category of the wrong type', async () => {
      const res = await api.post('/transactions', txnBody(cash, salary)).expect(400);
      expect(res.body.error.details[0].field).toBe('categoryId');
    });

    it('rejects transfers to the same account and across currencies', async () => {
      const base = { amount: '10', currency: 'BDT', occurredAt: '2026-11-02T10:00:00+06:00' };
      await api
        .post('/transfers', { ...base, sourceAccountId: cash, destinationAccountId: cash })
        .expect(400);

      const usd = (await createAccount(api, { name: 'USD card', type: 'BANK', currency: 'USD' }))
        .id;
      const res = await api
        .post('/transfers', { ...base, sourceAccountId: cash, destinationAccountId: usd })
        .expect(400);
      expect(res.body.error.details[0].field).toBe('destinationAccountId');
    });

    it('blocks new postings to an archived account, but still allows reversing old ones', async () => {
      const wallet = (
        await createAccount(api, { name: 'bKash', type: 'MOBILE_WALLET', openingBalance: '300' })
      ).id;
      const trx = await api
        .post('/transactions', txnBody(wallet, food, { amount: '100' }))
        .expect(201);
      await api.post(`/accounts/${wallet}/archive`, {}, null).expect(200);

      const blocked = await api
        .post('/transactions', txnBody(wallet, food, { amount: '1' }))
        .expect(409);
      expect(blocked.body.error.message).toMatch(/archived/);

      await api.post(`/transactions/${trx.body.data.id as string}/reverse`, {}).expect(200);
      expect(await balanceOf(api, wallet)).toBe('300.0000');
    });
  });

  describe('reversal (TRX-04)', () => {
    let api: Api;
    let cash: string;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      cash = (await createAccount(api, { openingBalance: '1000' })).id;
    });

    it('restores the balance, keeps history, and cannot be repeated', async () => {
      const posted = await api
        .post('/transactions', txnBody(cash, food, { amount: '400' }))
        .expect(201);
      const id = posted.body.data.id as string;
      expect(await balanceOf(api, cash)).toBe('600.0000');

      const reversed = await api
        .post(`/transactions/${id}/reverse`, { reason: 'Entered twice' })
        .expect(200);
      expect(reversed.body.data).toMatchObject({
        id,
        status: 'REVERSED',
        accountBalance: '1000.0000',
      });
      expect(reversed.body.data.reversedAt).not.toBeNull();

      // Original + reversal journals both remain; the reversal mirrors the original date.
      const trx = await prisma.transaction.findUniqueOrThrow({
        where: { id },
        include: { journalEntry: true, reversalJournal: { include: { lines: true } } },
      });
      expect(trx.reversalJournal?.kind).toBe('REVERSAL');
      expect(trx.reversalJournal?.reversesId).toBe(trx.journalEntryId);
      expect(trx.reversalJournal?.effectiveDate).toEqual(trx.journalEntry.effectiveDate);

      const again = await api.post(`/transactions/${id}/reverse`, {}).expect(409);
      expect(again.body.error.code).toBe('CONFLICT');

      const detail = await api.get(`/transactions/${id}`).expect(200);
      expect(detail.body.data.status).toBe('REVERSED');
    });

    it('reverses a transfer and restores both accounts', async () => {
      const bank = (await createAccount(api, { type: 'BANK' })).id;
      const t = await api
        .post('/transfers', {
          sourceAccountId: cash,
          destinationAccountId: bank,
          amount: '250',
          currency: 'BDT',
          occurredAt: '2026-11-02T09:00:00+06:00',
        })
        .expect(201);
      const before = await balanceOf(api, cash);
      await api.post(`/transfers/${t.body.data.id as string}/reverse`, {}).expect(200);
      expect(
        parseMoney(await balanceOf(api, cash))
          .minus(parseMoney(before))
          .toFixed(4),
      ).toBe('250.0000');
      expect(await balanceOf(api, bank)).toBe('0.0000');
      await api.post(`/transfers/${t.body.data.id as string}/reverse`, {}).expect(409);
    });
  });

  describe('idempotency (ADR-006)', () => {
    let api: Api;
    let email: string;
    let cash: string;

    beforeAll(async () => {
      const user = await newUser(app);
      api = user.api;
      email = user.session.email;
      cash = (await createAccount(api, { openingBalance: '5000' })).id;
    });

    const countFor = async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      return {
        transactions: await prisma.transaction.count({ where: { userId: user.id } }),
        journals: await prisma.journalEntry.count({ where: { userId: user.id } }),
      };
    };

    it('a retried request with the same key returns the original result and writes nothing', async () => {
      const key = randomUUID();
      const body = txnBody(cash, food, { amount: '450.00', description: 'Lunch' });
      const first = await api.post('/transactions', body, key).expect(201);
      const before = await countFor();

      const retry = await api.post('/transactions', body, key).expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.data).toEqual(first.body.data);
      expect(await countFor()).toEqual(before);
      expect(await balanceOf(api, cash)).toBe('4550.0000');
    });

    it('the same key with a different payload is rejected with 422', async () => {
      const key = randomUUID();
      await api.post('/transactions', txnBody(cash, food, { amount: '10' }), key).expect(201);
      const res = await api
        .post('/transactions', txnBody(cash, food, { amount: '11' }), key)
        .expect(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_MISMATCH');
    });

    it('concurrent duplicates create exactly one transaction', async () => {
      const key = randomUUID();
      const body = txnBody(cash, food, { amount: '7' });
      const before = await countFor();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => api.post('/transactions', body, key)),
      );

      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map((r) => (r.body.data as { id: string }).id)).size).toBe(1);
      const after = await countFor();
      expect(after.transactions - before.transactions).toBe(1);
      expect(after.journals - before.journals).toBe(1);
    });

    it('a key reused for a different resource (path id) is a mismatch, not a replay', async () => {
      const t1 = (await api.post('/transactions', txnBody(cash, food, { amount: '1' })).expect(201))
        .body.data.id as string;
      const t2 = (await api.post('/transactions', txnBody(cash, food, { amount: '1' })).expect(201))
        .body.data.id as string;
      const key = randomUUID();
      await api.post(`/transactions/${t1}/reverse`, {}, key).expect(200);
      expect(
        (await api.post(`/transactions/${t2}/reverse`, {}, key).expect(422)).body.error.code,
      ).toBe('IDEMPOTENCY_MISMATCH');
      expect((await api.get(`/transactions/${t2}`).expect(200)).body.data.status).toBe('POSTED');
    });

    it('a failed command stores no key, so the client can retry with the same key', async () => {
      const key = randomUUID();
      await api.post('/transactions', txnBody(cash, food, { currency: 'USD' }), key).expect(400);
      await api.post('/transactions', txnBody(cash, food, { amount: '3' }), key).expect(201);
    });
  });

  describe('atomicity', () => {
    it('an invalid journal rolls back everything written in the same transaction', async () => {
      const { api, session } = await newUser(app);
      const cash = (await createAccount(api, { openingBalance: '100' })).id;
      const user = await prisma.user.findUniqueOrThrow({ where: { email: session.email } });
      const ledgerAccount = await prisma.ledgerAccount.findUniqueOrThrow({
        where: { financialAccountId: cash },
      });
      const ledger = new LedgerService(prisma as unknown as PrismaService);
      const before = await prisma.journalEntry.count({ where: { userId: user.id } });

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.auditLog.create({ data: { userId: user.id, action: 'test.atomicity' } });
          await ledger.post(tx, {
            userId: user.id,
            kind: 'EXPENSE',
            currency: 'BDT',
            effectiveDate: '2026-11-01',
            lines: [
              {
                ledgerAccountId: ledgerAccount.id,
                debit: parseMoney('10'),
                credit: parseMoney('0'),
              },
              {
                ledgerAccountId: ledgerAccount.id,
                debit: parseMoney('0'),
                credit: parseMoney('9.99'),
              },
            ],
          });
        }),
      ).rejects.toThrow(UnbalancedJournalError);

      expect(await prisma.journalEntry.count({ where: { userId: user.id } })).toBe(before);
      expect(
        await prisma.auditLog.count({ where: { userId: user.id, action: 'test.atomicity' } }),
      ).toBe(0);
    });
  });

  describe('listing, filters and pagination', () => {
    let api: Api;
    let cash: string;
    let bank: string;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      cash = (await createAccount(api, { openingBalance: '10000' })).id;
      bank = (await createAccount(api, { type: 'BANK' })).id;
      await api
        .post(
          '/transactions',
          txnBody(cash, food, {
            amount: '100',
            occurredAt: '2026-10-05T12:00:00+06:00',
            description: 'Biryani lunch',
          }),
        )
        .expect(201);
      await api
        .post(
          '/transactions',
          txnBody(cash, food, { amount: '200', occurredAt: '2026-10-20T12:00:00+06:00' }),
        )
        .expect(201);
      await api
        .post(
          '/transactions',
          txnBody(bank, salary, {
            type: 'INCOME',
            amount: '9000',
            occurredAt: '2026-11-01T09:00:00+06:00',
          }),
        )
        .expect(201);
    });

    it('paginates newest first with the standard meta', async () => {
      const page1 = await api.get('/transactions?pageSize=2').expect(200);
      expect(page1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
      expect((page1.body.data as { effectiveDate: string }[]).map((t) => t.effectiveDate)).toEqual([
        '2026-11-01',
        '2026-10-20',
      ]);
      const page2 = await api.get('/transactions?pageSize=2&page=2').expect(200);
      expect(page2.body.data).toHaveLength(1);
    });

    it('filters by type, account, category, date range and text', async () => {
      expect((await api.get('/transactions?type=INCOME').expect(200)).body.meta.total).toBe(1);
      expect((await api.get(`/transactions?accountId=${cash}`).expect(200)).body.meta.total).toBe(
        2,
      );
      expect((await api.get(`/transactions?categoryId=${food}`).expect(200)).body.meta.total).toBe(
        2,
      );
      expect(
        (await api.get('/transactions?from=2026-10-10&to=2026-10-31').expect(200)).body.meta.total,
      ).toBe(1);
      expect((await api.get('/transactions?q=biryani').expect(200)).body.meta.total).toBe(1);
      await api.get('/transactions?from=2026-11-01&to=2026-10-01').expect(400);
      await api.get('/transactions?pageSize=500').expect(400);
      await api.get('/transactions?userId=x').expect(400);
    });

    it('lists transfers for an account', async () => {
      await api
        .post('/transfers', {
          sourceAccountId: cash,
          destinationAccountId: bank,
          amount: '50',
          currency: 'BDT',
          occurredAt: '2026-11-02T09:00:00+06:00',
        })
        .expect(201);
      const res = await api.get(`/transfers?accountId=${bank}`).expect(200);
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('cross-user isolation (IDOR)', () => {
    let a: Api;
    let b: Api;
    let aCash: string;
    let aTrx: string;
    let aTransfer: string;
    let bCash: string;

    beforeAll(async () => {
      ({ api: a } = await newUser(app));
      ({ api: b } = await newUser(app));
      aCash = (await createAccount(a, { openingBalance: '1000' })).id;
      const aBank = (await createAccount(a, { type: 'BANK' })).id;
      bCash = (await createAccount(b, { openingBalance: '1000' })).id;
      aTrx = (await a.post('/transactions', txnBody(aCash, food)).expect(201)).body.data
        .id as string;
      aTransfer = (
        await a
          .post('/transfers', {
            sourceAccountId: aCash,
            destinationAccountId: aBank,
            amount: '10',
            currency: 'BDT',
            occurredAt: '2026-11-02T09:00:00+06:00',
          })
          .expect(201)
      ).body.data.id as string;
    });

    it("B cannot read, change or archive A's account", async () => {
      expect((await b.get(`/accounts/${aCash}`).expect(404)).body.error.code).toBe('NOT_FOUND');
      await b.patch(`/accounts/${aCash}`, { name: 'pwned' }).expect(404);
      await b.post(`/accounts/${aCash}/archive`, {}, null).expect(404);
      const list = await b.get('/accounts?status=ALL').expect(200);
      expect((list.body.data as { id: string }[]).map((x) => x.id)).not.toContain(aCash);
    });

    it("B cannot read or reverse A's transaction or transfer", async () => {
      await b.get(`/transactions/${aTrx}`).expect(404);
      await b.post(`/transactions/${aTrx}/reverse`, {}).expect(404);
      await b.get(`/transfers/${aTransfer}`).expect(404);
      await b.post(`/transfers/${aTransfer}/reverse`, {}).expect(404);
      expect((await b.get('/transactions').expect(200)).body.meta.total).toBe(0);
      expect((await a.get(`/transactions/${aTrx}`).expect(200)).body.data.status).toBe('POSTED');
    });

    it("B cannot post into A's account or move money out of it", async () => {
      await b.post('/transactions', txnBody(aCash, food)).expect(404);
      await b
        .post('/transfers', {
          sourceAccountId: aCash,
          destinationAccountId: bCash,
          amount: '10',
          currency: 'BDT',
          occurredAt: '2026-11-02T09:00:00+06:00',
        })
        .expect(404);
      expect(await balanceOf(a, aCash)).toBe('490.0000');
    });

    it("B cannot use A's custom category", async () => {
      const aUser = await prisma.transaction.findUniqueOrThrow({ where: { id: aTrx } });
      const custom = await prisma.category.create({
        data: {
          userId: aUser.userId,
          type: 'EXPENSE',
          nameEn: `A only ${randomUUID().slice(0, 4)}`,
          nameBn: 'শুধু এ',
        },
      });
      await b.post('/transactions', txnBody(bCash, custom.id)).expect(404);
    });

    it('requires authentication everywhere', async () => {
      const anon = await import('supertest').then((m) => m.default(app.getHttpServer()));
      await anon.get('/api/v1/accounts').expect(401);
      await anon.get('/api/v1/transactions').expect(401);
      await anon.post('/api/v1/transfers').send({}).expect(401);
    });
  });
});
