import type {
  InvestmentDetailResponse,
  LoanDetailResponse,
  NetWorthItemResponse,
  NetWorthResponse,
} from '@takawise/contracts';
import { randomUUID } from 'node:crypto';
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

/**
 * Phase 8 (ADR-022/023): investments, loans, net-worth items and net worth,
 * through the real API and database. The core property throughout: moving
 * money between your own things never changes net worth or income/expense.
 */

const OPENED = '2026-09-01';
const WHEN = '2026-10-15T12:00:00+06:00';

async function netWorth(api: Api, asOf?: string) {
  const res = await api.get(`/net-worth${asOf ? `?asOf=${asOf}` : ''}`).expect(200);
  const body = res.body.data as NetWorthResponse;
  return body.currencies.find((c) => c.currency === 'BDT')!;
}

async function monthTotals(api: Api, month: string) {
  const res = await api.get(`/dashboard/overview?month=${month}`).expect(200);
  const data = res.body.data as { income: string; expense: string };
  return { income: data.income, expense: data.expense };
}

describe('wealth: investments, loans and net worth (API + DB)', () => {
  let app: TestApp;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = connectTestDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('investments', () => {
    let api: Api;
    let bank: string;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      bank = (
        await createAccount(api, {
          name: 'Bank',
          type: 'BANK',
          openingBalance: '100000',
          openingDate: OPENED,
        })
      ).id;
    });

    it('funding an FDR from a bank is a transfer: no new money, no spending', async () => {
      const before = await netWorth(api);
      const res = await api
        .post('/investments', {
          name: 'FDR 1 year',
          kind: 'FDR',
          openingDate: '2026-10-01',
          initialAmount: '50000',
          fundingAccountId: bank,
          interestRate: '9.5',
          maturityDate: '2027-10-01',
          expectedMaturityValue: '54750',
        })
        .expect(201);
      const fdr = res.body.data as InvestmentDetailResponse;
      expect(fdr.recordedValue).toBe('50000.0000');
      expect(fdr.currentValue).toBe('50000.0000');
      expect(fdr.valueBasis).toBe('RECORDED');
      expect(fdr.interestRate).toBe('9.5000');
      expect(await balanceOf(api, bank)).toBe('50000.0000');

      const after = await netWorth(api);
      expect(after.netWorth).toBe(before.netWorth);
      expect(after.groups.find((g) => g.group === 'INVESTMENTS')?.total).toBe('50000.0000');
      expect(await monthTotals(api, '2026-10')).toEqual({
        income: '0.0000',
        expense: '0.0000',
      });
    });

    it('an investment already held opens with a balance and adds to net worth', async () => {
      const before = await netWorth(api);
      const res = await api
        .post('/investments', {
          name: 'Sanchayapatra',
          kind: 'SAVINGS_CERTIFICATE',
          openingDate: OPENED,
          initialAmount: '200000',
        })
        .expect(201);
      expect((res.body.data as InvestmentDetailResponse).recordedValue).toBe('200000.0000');
      const after = await netWorth(api);
      expect(Number(after.netWorth) - Number(before.netWorth)).toBe(200000);
    });

    it('uses the latest valuation, rolled forward by later top-ups, and labels it', async () => {
      const created = (
        await api
          .post('/investments', {
            name: 'DSE shares',
            kind: 'STOCK',
            openingDate: OPENED,
            initialAmount: '10000',
            quantity: '100',
            quantityUnit: 'shares',
          })
          .expect(201)
      ).body.data as InvestmentDetailResponse;

      const valued = (
        await api
          .post(`/investments/${created.id}/valuations`, {
            value: '12500',
            valuedOn: '2026-10-01',
            source: 'ESTIMATED',
          })
          .expect(201)
      ).body.data as InvestmentDetailResponse;
      expect(valued.currentValue).toBe('12500.0000');
      expect(valued.recordedValue).toBe('10000.0000');
      expect(valued.valueBasis).toBe('ESTIMATED');
      expect(valued.valuedOn).toBe('2026-10-01');

      // Top up after the valuation → counted once, on top of the valuation.
      await api
        .post('/transfers', {
          sourceAccountId: bank,
          destinationAccountId: created.id,
          amount: '1000',
          currency: 'BDT',
          occurredAt: WHEN,
        })
        .expect(201);
      const detail = (await api.get(`/investments/${created.id}`).expect(200)).body
        .data as InvestmentDetailResponse;
      expect(detail.currentValue).toBe('13500.0000');
      expect(detail.recordedValue).toBe('11000.0000');

      const nw = await netWorth(api);
      const line = nw.lines.find((l) => l.id === created.id)!;
      expect(line.value).toBe('13500.0000');
      expect(line.basis).toBe('ESTIMATED');

      // As of before the valuation, the recorded value is used.
      const past = await netWorth(api, '2026-09-15');
      expect(past.lines.find((l) => l.id === created.id)!.basis).toBe('RECORDED');
    });

    it('rejects verified, future, pre-opening and duplicate-date valuations', async () => {
      const inv = (
        await api
          .post('/investments', {
            name: 'Gold',
            kind: 'GOLD',
            openingDate: OPENED,
            initialAmount: '30000',
          })
          .expect(201)
      ).body.data as InvestmentDetailResponse;
      const url = `/investments/${inv.id}/valuations`;
      await api.post(url, { value: '1', valuedOn: '2026-10-01', source: 'VERIFIED' }).expect(400);
      await api.post(url, { value: '1', valuedOn: '2099-01-01' }).expect(400);
      await api.post(url, { value: '1', valuedOn: '2026-08-01' }).expect(400);
      const ok = (await api.post(url, { value: '31000', valuedOn: '2026-10-02' }).expect(201)).body
        .data as InvestmentDetailResponse;
      await api.post(url, { value: '32000', valuedOn: '2026-10-02' }).expect(409);

      const valuationId = ok.valuations[0]!.id;
      const removed = (await api.delete(`${url}/${valuationId}`).expect(200)).body
        .data as InvestmentDetailResponse;
      expect(removed.valuations).toHaveLength(0);
      expect(removed.valueBasis).toBe('RECORDED');
    });

    it('records returns as income on the investment', async () => {
      const inv = (
        await api
          .post('/investments', {
            name: 'DPS',
            kind: 'DPS',
            openingDate: OPENED,
            initialAmount: '5000',
          })
          .expect(201)
      ).body.data as InvestmentDetailResponse;
      const profit = await categoryId(prisma, 'income.profit_interest');
      await api
        .post(
          '/transactions',
          txnBody(inv.id, profit, { type: 'INCOME', amount: '250', occurredAt: WHEN }),
        )
        .expect(201);
      const detail = (await api.get(`/investments/${inv.id}`).expect(200)).body
        .data as InvestmentDetailResponse;
      expect(detail.recordedValue).toBe('5250.0000');
      expect((await monthTotals(api, '2026-10')).income).toBe('250.0000');
    });

    it('keeps investment accounts out of POST /accounts and filters them by group', async () => {
      await api
        .post('/accounts', { name: 'Sneaky', type: 'INVESTMENT', openingDate: OPENED })
        .expect(400);
      const everyday = (await api.get('/accounts?group=EVERYDAY').expect(200)).body.data as Array<{
        type: string;
      }>;
      expect(everyday.every((a) => a.type !== 'INVESTMENT')).toBe(true);
      const wealth = (await api.get('/accounts?group=WEALTH').expect(200)).body.data as Array<{
        type: string;
      }>;
      expect(wealth.length).toBeGreaterThan(0);
      expect(wealth.every((a) => a.type === 'INVESTMENT')).toBe(true);
    });
  });

  describe('loans', () => {
    let api: Api;
    let bank: string;
    let loan: LoanDetailResponse;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      bank = (
        await createAccount(api, {
          name: 'Bank',
          type: 'BANK',
          openingBalance: '20000',
          openingDate: OPENED,
        })
      ).id;
    });

    it('a loan received into a bank account leaves net worth unchanged', async () => {
      const before = await netWorth(api);
      loan = (
        await api
          .post('/loans', {
            direction: 'BORROWED',
            name: 'Personal loan',
            counterparty: 'City Bank',
            openingDate: '2026-09-15',
            principal: '100000',
            disbursementAccountId: bank,
            interestRate: '12',
            termMonths: 12,
            firstPaymentDate: '2026-10-15',
          })
          .expect(201)
      ).body.data as LoanDetailResponse;
      expect(loan.outstanding).toBe('100000.0000');
      expect(loan.instalment).toBe('8884.8800');
      expect(loan.schedule).toHaveLength(12);
      expect(loan.schedule.at(-1)!.balance).toBe('0.0000');
      expect(loan.nextDueDate).toBe('2026-10-15');
      expect(loan.suggestedPayment).toEqual({ principal: '7884.8800', interest: '1000.0000' });
      expect(await balanceOf(api, bank)).toBe('120000.0000');
      expect((await netWorth(api)).netWorth).toBe(before.netWorth);
      expect((await netWorth(api)).groups.find((g) => g.group === 'LOANS')?.total).toBe(
        '100000.0000',
      );
    });

    it('a payment splits into a principal transfer and an interest expense, atomically and once', async () => {
      const key = randomUUID();
      const body = {
        accountId: bank,
        occurredAt: WHEN,
        principal: '7884.88',
        interest: '1000',
      };
      const first = await api.post(`/loans/${loan.id}/payments`, body, key).expect(201);
      const replay = await api.post(`/loans/${loan.id}/payments`, body, key).expect(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      loan = first.body.data as LoanDetailResponse;

      expect(loan.outstanding).toBe('92115.1200');
      expect(loan.principalRepaid).toBe('7884.8800');
      expect(loan.interestPaid).toBe('1000.0000');
      expect(loan.payments).toHaveLength(1);
      expect(loan.payments[0]!.total).toBe('8884.8800');
      expect(loan.payments[0]!.account.id).toBe(bank);
      expect(loan.nextDueDate).toBe('2026-11-15');
      expect(await balanceOf(api, bank)).toBe('111115.1200');

      // Only the interest is spending; the principal is a transfer.
      expect((await monthTotals(api, '2026-10')).expense).toBe('1000.0000');
      const interestTxn = await prisma.transaction.findUniqueOrThrow({
        where: { id: loan.payments[0]!.transactionId! },
        include: { category: true },
      });
      expect(interestTxn.category.systemKey).toBe('expense.loan_interest');
    });

    it('refuses a principal above what is outstanding', async () => {
      await api
        .post(`/loans/${loan.id}/payments`, {
          accountId: bank,
          occurredAt: WHEN,
          principal: '999999',
        })
        .expect(400);
    });

    it('protects the payment: its parts cannot be reversed alone, only together', async () => {
      const payment = loan.payments[0]!;
      await api.post(`/transfers/${payment.transferId}/reverse`, {}).expect(409);
      await api.post(`/transactions/${payment.transactionId}/reverse`, {}).expect(409);

      const reversed = (
        await api.post(`/loans/${loan.id}/payments/${payment.id}/reverse`, {}).expect(200)
      ).body.data as LoanDetailResponse;
      expect(reversed.outstanding).toBe('100000.0000');
      expect(reversed.payments[0]!.status).toBe('REVERSED');
      expect(reversed.principalRepaid).toBe('0.0000');
      expect(await balanceOf(api, bank)).toBe('120000.0000');
      expect((await monthTotals(api, '2026-10')).expense).toBe('0.0000');
      await api.post(`/loans/${loan.id}/payments/${payment.id}/reverse`, {}).expect(409);
    });

    it('an existing loan opens at its outstanding amount and lowers net worth', async () => {
      const before = await netWorth(api);
      const res = await api
        .post('/loans', {
          direction: 'BORROWED',
          name: 'Home loan',
          openingDate: OPENED,
          principal: '3000000',
          outstandingBalance: '2400000',
        })
        .expect(201);
      const existing = res.body.data as LoanDetailResponse;
      expect(existing.outstanding).toBe('2400000.0000');
      expect(existing.schedule).toEqual([]);
      expect(existing.nextDueDate).toBeNull();
      const after = await netWorth(api);
      expect(Number(before.netWorth) - Number(after.netWorth)).toBe(2400000);
    });

    it('money lent is an asset; a repayment received brings it back with interest income', async () => {
      const lent = (
        await api
          .post('/loans', {
            direction: 'LENT',
            name: 'Lent to cousin',
            counterparty: 'Rahim',
            openingDate: '2026-10-01',
            principal: '10000',
            disbursementAccountId: bank,
          })
          .expect(201)
      ).body.data as LoanDetailResponse;
      expect(lent.outstanding).toBe('10000.0000');
      const bankBefore = await balanceOf(api, bank);

      const after = (
        await api
          .post(`/loans/${lent.id}/payments`, {
            accountId: bank,
            occurredAt: WHEN,
            principal: '4000',
            interest: '100',
          })
          .expect(201)
      ).body.data as LoanDetailResponse;
      expect(after.outstanding).toBe('6000.0000');
      expect(Number(await balanceOf(api, bank)) - Number(bankBefore)).toBe(4100);
      expect((await monthTotals(api, '2026-10')).income).toBe('100.0000');
      const nw = await netWorth(api);
      expect(nw.groups.find((g) => g.group === 'MONEY_LENT')?.total).toBe('6000.0000');
    });

    it('validates terms and blocks goals on loan accounts', async () => {
      await api
        .post('/loans', {
          direction: 'BORROWED',
          name: 'Half terms',
          openingDate: OPENED,
          principal: '1000',
          termMonths: 12,
        })
        .expect(400);
      await api
        .post('/goals', { name: 'Bad goal', targetAmount: '100', linkedAccountId: loan.id })
        .expect(400);
      await api.patch(`/loans/${loan.id}`, { termMonths: null }).expect(400);
      const updated = (
        await api
          .patch(`/loans/${loan.id}`, { termMonths: null, firstPaymentDate: null })
          .expect(200)
      ).body.data as LoanDetailResponse;
      expect(updated.schedule).toEqual([]);
      expect(updated.instalment).toBeNull();
    });
  });

  describe('net-worth items and history', () => {
    let api: Api;

    beforeAll(async () => {
      ({ api } = await newUser(app));
      await createAccount(api, { name: 'Cash', openingBalance: '5000', openingDate: OPENED });
    });

    it('adds assets and liabilities that are not accounts, valued by the user', async () => {
      const flat = (
        await api
          .post('/net-worth/items', {
            name: 'Flat in Mirpur',
            kind: 'REAL_ESTATE',
            value: '6000000',
            valuedOn: '2026-10-01',
            source: 'ESTIMATED',
          })
          .expect(201)
      ).body.data as NetWorthItemResponse;
      expect(flat.side).toBe('ASSET');
      expect(flat.valueBasis).toBe('ESTIMATED');

      const debt = (
        await api
          .post('/net-worth/items', {
            name: 'Owed to uncle',
            kind: 'PERSONAL_DEBT',
            value: '50000',
            valuedOn: '2026-10-01',
          })
          .expect(201)
      ).body.data as NetWorthItemResponse;
      expect(debt.side).toBe('LIABILITY');

      const nw = await netWorth(api);
      expect(nw.assets).toBe('6005000.0000');
      expect(nw.liabilities).toBe('50000.0000');
      expect(nw.netWorth).toBe('5955000.0000');

      await api
        .post('/net-worth/items', {
          name: 'flat in mirpur',
          kind: 'REAL_ESTATE',
          value: '1',
          valuedOn: '2026-10-01',
        })
        .expect(409);

      // Revalue, then try to delete down to zero valuations.
      const revalued = (
        await api
          .post(`/net-worth/items/${flat.id}/valuations`, {
            value: '6200000',
            valuedOn: '2026-11-01',
          })
          .expect(201)
      ).body.data as NetWorthItemResponse;
      expect(revalued.value).toBe('6200000.0000');
      await api
        .delete(`/net-worth/items/${debt.id}/valuations/${debt.valuations[0]!.id}`)
        .expect(409);

      // Settled debt: archived items stop counting.
      await api.post(`/net-worth/items/${debt.id}/archive`, {}).expect(200);
      expect((await netWorth(api)).liabilities).toBe('0.0000');
    });

    it('returns month-end history per currency', async () => {
      const res = await api.get('/net-worth/history?months=3').expect(200);
      const data = res.body.data as {
        dates: string[];
        series: Array<{ currency: string; points: Array<{ netWorth: string }> }>;
      };
      expect(data.dates).toHaveLength(3);
      const bdt = data.series.find((s) => s.currency === 'BDT')!;
      expect(bdt.points).toHaveLength(3);
      expect(bdt.points.at(-1)!.netWorth).toBe('6205000.0000');
      await api.get('/net-worth/history?months=99').expect(400);
      await api.get('/net-worth?asOf=2099-01-01').expect(400);
    });
  });

  describe('ownership and database backstops', () => {
    it("user B cannot see or touch user A's investments, loans or items", async () => {
      const a = await newUser(app);
      const b = await newUser(app);
      const inv = (
        await a.api
          .post('/investments', {
            name: 'A FDR',
            kind: 'FDR',
            openingDate: OPENED,
            initialAmount: '1000',
          })
          .expect(201)
      ).body.data as InvestmentDetailResponse;
      const loan = (
        await a.api
          .post('/loans', {
            direction: 'BORROWED',
            name: 'A loan',
            openingDate: OPENED,
            principal: '1000',
          })
          .expect(201)
      ).body.data as LoanDetailResponse;
      const item = (
        await a.api
          .post('/net-worth/items', {
            name: 'A car',
            kind: 'VEHICLE',
            value: '900000',
            valuedOn: '2026-10-01',
          })
          .expect(201)
      ).body.data as NetWorthItemResponse;
      const bCash = (await createAccount(b.api, { openingBalance: '100', openingDate: OPENED })).id;

      await b.api.get(`/investments/${inv.id}`).expect(404);
      await b.api
        .post(`/investments/${inv.id}/valuations`, { value: '1', valuedOn: '2026-10-01' })
        .expect(404);
      await b.api.get(`/loans/${loan.id}`).expect(404);
      await b.api
        .post(`/loans/${loan.id}/payments`, { accountId: bCash, occurredAt: WHEN, principal: '1' })
        .expect(404);
      await b.api.get(`/net-worth/items/${item.id}`).expect(404);
      await b.api.patch(`/net-worth/items/${item.id}`, { name: 'Mine now' }).expect(404);
      // A cannot pay their loan from B's account either.
      await a.api
        .post(`/loans/${loan.id}/payments`, { accountId: bCash, occurredAt: WHEN, principal: '1' })
        .expect(404);
      const bNetWorth = await netWorth(b.api);
      expect(bNetWorth.netWorth).toBe('100.0000');
    });

    it('the database rejects verified valuations and edits to loan payments', async () => {
      const { api, session } = await newUser(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: session.email } });
      const inv = (
        await api
          .post('/investments', {
            name: 'X',
            kind: 'BOND',
            openingDate: OPENED,
            initialAmount: '1',
          })
          .expect(201)
      ).body.data as InvestmentDetailResponse;
      await expect(
        prisma.valuation.create({
          data: {
            userId: user.id,
            investmentId: inv.id,
            value: '1',
            currency: 'BDT',
            valuedOn: new Date('2026-10-01T00:00:00Z'),
            source: 'VERIFIED',
          },
        }),
      ).rejects.toThrow();

      const bank = (await createAccount(api, { openingBalance: '500', openingDate: OPENED })).id;
      const loan = (
        await api
          .post('/loans', {
            direction: 'BORROWED',
            name: 'Y',
            openingDate: OPENED,
            principal: '300',
          })
          .expect(201)
      ).body.data as LoanDetailResponse;
      const paid = (
        await api
          .post(`/loans/${loan.id}/payments`, {
            accountId: bank,
            occurredAt: WHEN,
            principal: '100',
          })
          .expect(201)
      ).body.data as LoanDetailResponse;
      const paymentId = paid.payments[0]!.id;
      await expect(
        prisma.loanPayment.update({ where: { id: paymentId }, data: { principal: '1' } }),
      ).rejects.toThrow();
      await expect(prisma.loanPayment.delete({ where: { id: paymentId } })).rejects.toThrow();
    });
  });
});
