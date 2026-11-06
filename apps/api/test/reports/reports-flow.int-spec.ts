import type { AccountReportRow } from '@takawise/contracts';
import request from 'supertest';
import type { App } from 'supertest/types';
import { money } from '../../src/domain/money/money';
import type { PrismaClient } from '../../src/generated/prisma/client';
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

/** Σ natural balance of a system ledger account over journal lines in [from, to], straight from the ledger. */
async function ledgerTotal(
  prisma: PrismaClient,
  userId: string,
  code: 'INCOME' | 'EXPENSE',
  from: string,
  to: string,
): Promise<string> {
  const sums = await prisma.journalLine.aggregate({
    where: {
      currency: 'BDT',
      ledgerAccount: { userId, systemCode: code },
      journalEntry: {
        effectiveDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
    },
    _sum: { debit: true, credit: true },
  });
  const debit = money(sums._sum.debit ?? '0');
  const credit = money(sums._sum.credit ?? '0');
  return (code === 'EXPENSE' ? debit.minus(credit) : credit.minus(debit)).toFixed(4);
}

describe('dashboard, reports and export (API + DB)', () => {
  let app: TestApp;
  let prisma: PrismaClient;
  let api: Api;
  let userId: string;
  let cash: string;
  let bank: string;
  let card: string;
  let food: string;
  let transport: string;
  let salary: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = connectTestDb();
    food = await categoryId(prisma, 'expense.food');
    transport = await categoryId(prisma, 'expense.transport');
    salary = await categoryId(prisma, 'income.salary');

    const user = await newUser(app);
    api = user.api;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: user.session.email } })).id;
    cash = (
      await createAccount(api, { name: 'Cash', openingBalance: '20000', openingDate: '2026-08-01' })
    ).id;
    bank = (await createAccount(api, { name: 'Bank', type: 'BANK', openingDate: '2026-08-01' })).id;
    card = (
      await createAccount(api, {
        name: 'Card',
        type: 'CREDIT_CARD_TRACKING',
        openingDate: '2026-08-01',
      })
    ).id;
    const usd = (
      await createAccount(api, {
        name: 'USD',
        currency: 'USD',
        openingBalance: '100',
        openingDate: '2026-08-01',
      })
    ).id;
    const post = (body: object) => api.post('/transactions', body).expect(201);

    // September
    await post(
      txnBody(bank, salary, {
        type: 'INCOME',
        amount: '50000',
        occurredAt: '2026-09-01T10:00:00+06:00',
      }),
    );
    await post(txnBody(cash, food, { amount: '3000', occurredAt: '2026-09-10T13:00:00+06:00' }));
    // October
    await post(
      txnBody(bank, salary, {
        type: 'INCOME',
        amount: '50000',
        occurredAt: '2026-10-01T10:00:00+06:00',
      }),
    );
    await post(txnBody(cash, food, { amount: '4000', occurredAt: '2026-10-12T13:00:00+06:00' }));
    await post(
      txnBody(card, transport, { amount: '1500', occurredAt: '2026-10-20T09:00:00+06:00' }),
    );
    // November (with one reversed expense, a transfer and a USD expense that must not count)
    await post(
      txnBody(bank, salary, {
        type: 'INCOME',
        amount: '52000',
        occurredAt: '2026-11-01T10:00:00+06:00',
      }),
    );
    await post(
      txnBody(cash, food, {
        amount: '2500',
        occurredAt: '2026-11-02T13:00:00+06:00',
        description: '=HYPERLINK("http://evil.example")',
      }),
    );
    await post(
      txnBody(cash, transport, { amount: '700', occurredAt: '2026-11-03T09:00:00+06:00' }),
    );
    const mistake = await post(
      txnBody(cash, food, { amount: '9999', occurredAt: '2026-11-03T12:00:00+06:00' }),
    );
    await api.post(`/transactions/${mistake.body.data.id as string}/reverse`, {}).expect(200);
    await api
      .post('/transfers', {
        sourceAccountId: bank,
        destinationAccountId: card,
        amount: '1500',
        currency: 'BDT',
        occurredAt: '2026-11-04T10:00:00+06:00',
      })
      .expect(201);
    await post(
      txnBody(usd, food, {
        amount: '20',
        currency: 'USD',
        occurredAt: '2026-11-04T10:00:00+06:00',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('cash flow (REP-01)', () => {
    it('returns monthly income, expense and net in the default currency', async () => {
      const res = await api.get('/reports/cash-flow?from=2026-08&to=2026-11').expect(200);
      expect(res.body.data).toEqual({
        currency: 'BDT',
        months: [
          { month: '2026-08', income: '0.0000', expense: '0.0000', net: '0.0000' },
          { month: '2026-09', income: '50000.0000', expense: '3000.0000', net: '47000.0000' },
          { month: '2026-10', income: '50000.0000', expense: '5500.0000', net: '44500.0000' },
          { month: '2026-11', income: '52000.0000', expense: '3200.0000', net: '48800.0000' },
        ],
        totals: { income: '152000.0000', expense: '11700.0000', net: '140300.0000' },
      });
    });

    it('reconciles every month with the ledger (reversals and transfers net out)', async () => {
      const res = await api.get('/reports/cash-flow?from=2026-09&to=2026-11').expect(200);
      for (const point of res.body.data.months as {
        month: string;
        income: string;
        expense: string;
      }[]) {
        const start = `${point.month}-01`;
        const end = new Date(
          Date.UTC(Number(point.month.slice(0, 4)), Number(point.month.slice(5)), 0),
        )
          .toISOString()
          .slice(0, 10);
        expect(await ledgerTotal(prisma, userId, 'INCOME', start, end)).toBe(point.income);
        expect(await ledgerTotal(prisma, userId, 'EXPENSE', start, end)).toBe(point.expense);
      }
    });

    it('is bounded and validated', async () => {
      await api.get('/reports/cash-flow?from=2024-01&to=2026-11').expect(400);
      await api.get('/reports/cash-flow?from=2026-11&to=2026-10').expect(400);
      expect(
        (await api.get('/reports/cash-flow?from=2026-11&to=2026-11&currency=USD').expect(200)).body
          .data.totals.expense,
      ).toBe('20.0000');
    });
  });

  describe('category breakdown', () => {
    it('ranks categories by total with shares, matching the cash-flow total', async () => {
      const res = await api.get('/reports/categories?from=2026-09-01&to=2026-11-30').expect(200);
      const data = res.body.data as {
        total: string;
        categories: { id: string; total: string; share: string; nameBn: string }[];
      };
      expect(data.total).toBe('11700.0000');
      expect(data.categories.map((c) => [c.id, c.total, c.share])).toEqual([
        [food, '9500.0000', '81.20'],
        [transport, '2200.0000', '18.80'],
      ]);
      expect(data.categories[0]!.nameBn).toBe('খাবার ও রেস্তোরাঁ');
    });

    it('supports income and rejects ranges over a year', async () => {
      const income = await api
        .get('/reports/categories?from=2026-11-01&to=2026-11-30&type=INCOME')
        .expect(200);
      expect(income.body.data.categories).toEqual([
        expect.objectContaining({ id: salary, total: '52000.0000', share: '100.00' }),
      ]);
      await api.get('/reports/categories?from=2025-01-01&to=2026-11-30').expect(400);
    });
  });

  describe('account summary', () => {
    it('rolls opening + movements into closing balances that match the live account balances', async () => {
      const res = await api.get('/reports/accounts?from=2026-10-01&to=2026-11-30').expect(200);
      const rows: Record<string, AccountReportRow> = Object.fromEntries(
        (res.body.data.accounts as AccountReportRow[]).map((r) => [r.account.id, r]),
      );

      // Cash: 20000 − 3000 (Sep) = 17000 at 1 Oct; then −4000, −2500, −700, and the reversed 9999 in and out.
      expect(rows[cash]).toMatchObject({
        openingBalance: '17000.0000',
        increase: '9999.0000',
        decrease: '17199.0000',
        closingBalance: '9800.0000',
      });
      // Card (liability): owed 1500 in Oct, paid 1500 in Nov.
      expect(rows[card]).toMatchObject({
        balanceType: 'LIABILITY',
        openingBalance: '0.0000',
        increase: '1500.0000',
        decrease: '1500.0000',
        closingBalance: '0.0000',
      });
      for (const id of [cash, bank, card]) {
        expect(rows[id]!.closingBalance).toBe(await balanceOf(api, id));
      }
    });
  });

  describe('dashboard (DASH-01)', () => {
    it('summarises the month from the same ledger data', async () => {
      await api
        .post(
          '/budgets',
          {
            month: '2026-11',
            overallAmount: '3000',
            items: [{ categoryId: food, amount: '2000' }],
          },
          null,
        )
        .expect(201);
      const res = await api.get('/dashboard/overview?month=2026-11').expect(200);
      const d = res.body.data;

      const assets = money(await balanceOf(api, cash)).plus(money(await balanceOf(api, bank)));
      expect(d).toMatchObject({
        month: '2026-11',
        currency: 'BDT',
        otherCurrencies: ['USD'],
        income: '52000.0000',
        expense: '3200.0000',
        netCashFlow: '48800.0000',
        assets: assets.toFixed(4),
        liabilities: '0.0000',
        netBalance: assets.toFixed(4),
        previous: {
          month: '2026-10',
          income: '50000.0000',
          expense: '5500.0000',
          netCashFlow: '44500.0000',
        },
        budget: {
          itemsOver: 1,
          overall: expect.objectContaining({ status: 'over', percentUsed: '106.67' }),
        },
      });
      expect((d.topExpenseCategories as { id: string }[]).map((c) => c.id)).toEqual([
        food,
        transport,
      ]);
      expect(d.recentTransactions.length).toBeLessThanOrEqual(5);
    });

    it('is empty — not someone else’s — for a new user', async () => {
      const { api: other } = await newUser(app);
      const res = await other.get('/dashboard/overview?month=2026-11').expect(200);
      expect(res.body.data).toMatchObject({
        income: '0.0000',
        expense: '0.0000',
        netBalance: '0.0000',
        topExpenseCategories: [],
        recentTransactions: [],
        budget: null,
      });
      expect(
        (await other.get('/reports/cash-flow?from=2026-09&to=2026-11').expect(200)).body.data.totals
          .income,
      ).toBe('0.0000');
    });
  });

  describe('CSV export (EXP-01)', () => {
    it('exports own transactions and transfers with formula-safe cells and a BOM', async () => {
      const res = await api
        .get('/exports/transactions')
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => (data += chunk));
          r.on('end', () => cb(null, data));
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="takawise-transactions-\d{4}-\d{2}-\d{2}\.csv"/,
      );
      const text = res.body as string;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const lines = text.slice(1).trim().split('\r\n');
      expect(lines[0]).toBe(
        '"date","kind","status","account","to_account","category_en","category_bn","amount","currency","description","occurred_at","id"',
      );
      // 10 transactions (Sep 2, Oct 3, Nov 5 incl. the REVERSED one and the USD one) + 1 transfer.
      expect(lines).toHaveLength(1 + 10 + 1);
      expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
      expect(text).toContain('"খাবার ও রেস্তোরাঁ"');
      expect(text).toContain('"REVERSED"');
      expect(text).toMatch(/"TRANSFER","POSTED","Bank","Card"/);
    });

    it('filters by date and requires authentication', async () => {
      const res = await api.get('/exports/transactions?from=2026-11-01&to=2026-11-30').expect(200);
      const lines = (res.text ?? '').trim().split('\r\n');
      // November: 5 transactions + 1 transfer.
      expect(lines.length).toBe(1 + 5 + 1);
      await request(app.getHttpServer() as App)
        .get('/api/v1/exports/transactions')
        .expect(401);
    });

    it("never includes another user's data", async () => {
      const { api: other } = await newUser(app);
      const res = await other.get('/exports/transactions').expect(200);
      expect((res.text ?? '').trim().split('\r\n')).toHaveLength(1);
    });
  });
});
