import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { bearer, registerAndVerify, server, type Session } from '../auth/auth-helpers';
import type { TestApp } from '../utils/create-test-app';

/** Authenticated API client for one test user. */
export function client(app: TestApp, session: Session) {
  const auth = bearer(session);
  return {
    get: (path: string) => request(server(app)).get(`/api/v1${path}`).set('Authorization', auth),
    patch: (path: string, body: object) =>
      request(server(app)).patch(`/api/v1${path}`).set('Authorization', auth).send(body),
    delete: (path: string) =>
      request(server(app)).delete(`/api/v1${path}`).set('Authorization', auth),
    put: (path: string, body: object = {}) =>
      request(server(app)).put(`/api/v1${path}`).set('Authorization', auth).send(body),
    /** POST with a fresh Idempotency-Key unless one is given (null = omit the header). */
    post: (path: string, body: object = {}, key: string | null = randomUUID()) => {
      const req = request(server(app)).post(`/api/v1${path}`).set('Authorization', auth);
      return key === null ? req.send(body) : req.set('Idempotency-Key', key).send(body);
    },
  };
}

export type Api = ReturnType<typeof client>;

export async function newUser(
  app: TestApp,
): Promise<{ api: Api; session: Session & { email: string } }> {
  const session = await registerAndVerify(app);
  return { api: client(app, session), session };
}

export async function createAccount(
  api: Api,
  body: Partial<{
    name: string;
    type: string;
    openingBalance: string;
    currency: string;
    openingDate: string;
  }> = {},
): Promise<{ id: string; balance: string }> {
  const res = await api
    .post('/accounts', {
      name: body.name ?? `Account ${randomUUID().slice(0, 6)}`,
      type: body.type ?? 'CASH',
      openingDate: body.openingDate ?? '2026-01-01',
      openingBalance: body.openingBalance ?? '0',
      ...(body.currency ? { currency: body.currency } : {}),
    })
    .expect(201);
  return res.body.data as { id: string; balance: string };
}

export async function balanceOf(api: Api, accountId: string): Promise<string> {
  const res = await api.get(`/accounts/${accountId}`).expect(200);
  return (res.body.data as { balance: string }).balance;
}

export async function categoryId(prisma: PrismaClient, key: string): Promise<string> {
  return (await prisma.category.findUniqueOrThrow({ where: { systemKey: key } })).id;
}

export function txnBody(
  accountId: string,
  categoryId: string,
  overrides: Partial<{
    type: 'INCOME' | 'EXPENSE';
    amount: string;
    occurredAt: string;
    currency: string;
    description: string;
  }> = {},
) {
  return {
    type: overrides.type ?? 'EXPENSE',
    accountId,
    categoryId,
    amount: overrides.amount ?? '500',
    currency: overrides.currency ?? 'BDT',
    occurredAt: overrides.occurredAt ?? '2026-11-01T12:30:00+06:00',
    ...(overrides.description ? { description: overrides.description } : {}),
  };
}

/** Natural-sign balance of a user's system ledger account straight from journal lines. */
export async function systemLedgerBalance(
  prisma: PrismaClient,
  email: string,
  code: 'INCOME' | 'EXPENSE',
): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const account = await prisma.ledgerAccount.findUniqueOrThrow({
    where: { userId_systemCode: { userId: user.id, systemCode: code } },
  });
  const sums = await prisma.journalLine.aggregate({
    where: { ledgerAccountId: account.id },
    _sum: { debit: true, credit: true },
  });
  const debit = sums._sum.debit?.toNumber() ?? 0;
  const credit = sums._sum.credit?.toNumber() ?? 0;
  // Test-only convenience; amounts here are small integers, so Number is exact.
  return (code === 'EXPENSE' ? debit - credit : credit - debit).toFixed(4);
}
