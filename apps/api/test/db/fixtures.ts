import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../src/database/prisma-client';
import {
  ledgerClassForAccountType,
  normalBalanceFor,
  SYSTEM_LEDGER_ACCOUNTS,
} from '../../src/domain/ledger/ledger-rules';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { FinancialAccountType, JournalKind } from '../../src/generated/prisma/enums';
import { assertSafeTestDatabase, TEST_DATABASE_URL } from '../utils/test-database';

export function connectTestDb(): PrismaClient {
  assertSafeTestDatabase(TEST_DATABASE_URL);
  return createPrismaClient({ connectionString: TEST_DATABASE_URL, maxConnections: 4 });
}

export type TestUser = {
  id: string;
  ledger: { opening: string; income: string; expense: string };
};

/** A fresh user with its system ledger accounts (what registration will do in Phase 3). */
export async function createTestUser(prisma: PrismaClient): Promise<TestUser> {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}@test.takawise.local`,
      passwordHash: 'not-a-real-hash',
      profile: { create: { fullName: 'Test User' } },
      ledgerAccounts: {
        create: SYSTEM_LEDGER_ACCOUNTS.map((a) => ({
          systemCode: a.code,
          class: a.class,
          normalBalance: normalBalanceFor(a.class),
          name: a.nameEn,
        })),
      },
    },
    include: { ledgerAccounts: true },
  });
  const byCode = (code: string) => {
    const account = user.ledgerAccounts.find((a) => a.systemCode === code);
    if (!account) throw new Error(`missing system ledger account ${code}`);
    return account.id;
  };
  return {
    id: user.id,
    ledger: {
      opening: byCode('EQUITY_OPENING_BALANCE'),
      income: byCode('INCOME'),
      expense: byCode('EXPENSE'),
    },
  };
}

export type TestAccount = { id: string; ledgerAccountId: string };

export async function createTestAccount(
  prisma: PrismaClient,
  userId: string,
  overrides: { type?: FinancialAccountType; currency?: string; name?: string } = {},
): Promise<TestAccount> {
  const type = overrides.type ?? 'CASH';
  const cls = ledgerClassForAccountType(type);
  const account = await prisma.financialAccount.create({
    data: {
      userId,
      name: overrides.name ?? `Account ${randomUUID().slice(0, 8)}`,
      type,
      currency: overrides.currency ?? 'BDT',
      openingDate: new Date('2026-01-01'),
      ledgerAccount: {
        // userId is inherited through the composite (financial_account_id, user_id) FK.
        create: { class: cls, normalBalance: normalBalanceFor(cls), name: 'mapped' },
      },
    },
    include: { ledgerAccount: true },
  });
  return { id: account.id, ledgerAccountId: account.ledgerAccount!.id };
}

export type LineInput = {
  ledgerAccountId: string;
  debit?: string;
  credit?: string;
  currency?: string;
};

/** Post a journal with nested lines in one statement (one implicit transaction). */
export function postJournal(
  prisma: Pick<PrismaClient, 'journalEntry'>,
  userId: string,
  kind: JournalKind,
  lines: LineInput[],
  extra: { currency?: string; reversesId?: string } = {},
) {
  const currency = extra.currency ?? 'BDT';
  return prisma.journalEntry.create({
    data: {
      userId,
      kind,
      currency,
      effectiveDate: new Date('2026-11-05'),
      reversesId: extra.reversesId,
      lines: {
        create: lines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          debit: l.debit ?? '0',
          credit: l.credit ?? '0',
          currency: l.currency ?? currency,
        })),
      },
    },
  });
}

export async function systemCategoryId(prisma: PrismaClient, key: string): Promise<string> {
  const category = await prisma.category.findUniqueOrThrow({ where: { systemKey: key } });
  return category.id;
}

/**
 * Collects the text of a Prisma/driver error (message + causes) so tests can
 * assert on the named constraint or trigger message.
 */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (current instanceof Error) {
        parts.push(current.message);
        const meta = (current as { meta?: unknown }).meta;
        if (meta) parts.push(JSON.stringify(meta));
        current = (current as { cause?: unknown }).cause;
      } else {
        parts.push(JSON.stringify(current));
        break;
      }
    }
    return parts.join(' | ');
  }
  throw new Error('Expected the database operation to fail, but it succeeded');
}
