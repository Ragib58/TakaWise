/**
 * Synthetic data for load tests (Phase 7). NEVER run against production.
 *
 *   pnpm --filter @takawise/api exec tsx scripts/seed-load-test.ts [email] [transactions]
 *
 * Creates (or reuses) one ACTIVE user with 5 accounts, ~12 months of income and
 * expenses, transfers, a budget and goals — all posted through the same ledger
 * templates and DB invariants as the API (balanced journals, triggers).
 */
import { randomInt } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { createPrismaClient } from '../src/database/prisma-client';
import type { PrismaService } from '../src/database/prisma.service';
import {
  ledgerClassForAccountType,
  normalBalanceFor,
  SYSTEM_LEDGER_ACCOUNTS,
} from '../src/domain/ledger/ledger-rules';
import {
  expenseLines,
  incomeLines,
  openingBalanceLines,
  transferLines,
} from '../src/domain/ledger/posting-templates';
import { parseMoney, toMoneyString } from '../src/domain/money/money';
import { dateOnly, localDateOf } from '../src/domain/time/local-date';
import { ARGON2_OPTIONS } from '../src/modules/auth/crypto/password-hasher.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';

const EMAIL = (process.argv[2] ?? 'loadtest@takawise.local').toLowerCase();
const TRANSACTIONS = Number.parseInt(process.argv[3] ?? '6000', 10);
export const LOAD_TEST_PASSWORD = 'load test passphrase 2026';
const TZ = 'Asia/Dhaka';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed load-test data in production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const prisma = createPrismaClient({ connectionString: url, maxConnections: 4 });
  const ledger = new LedgerService(prisma as unknown as PrismaService);
  try {
    const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (existing) {
      console.warn(`User ${EMAIL} already exists — reusing it (no new data).`);
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await hash(LOAD_TEST_PASSWORD, ARGON2_OPTIONS),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: 'Load Test' } },
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
    const system = (code: string) => user.ledgerAccounts.find((a) => a.systemCode === code)!.id;

    const now = new Date();
    const start = new Date(now.getTime() - 365 * 86_400_000);
    const openingDate = localDateOf(start, TZ);

    const specs = [
      { name: 'Cash', type: 'CASH', opening: '50000' },
      { name: 'City Bank', type: 'BANK', opening: '500000' },
      { name: 'bKash', type: 'MOBILE_WALLET', opening: '20000' },
      { name: 'Savings', type: 'SAVINGS', opening: '200000' },
      { name: 'Visa', type: 'CREDIT_CARD_TRACKING', opening: '0' },
    ] as const;
    const accounts: Array<{ id: string; ledgerId: string }> = [];
    for (const spec of specs) {
      const cls = ledgerClassForAccountType(spec.type);
      const account = await prisma.$transaction(async (tx) => {
        const created = await tx.financialAccount.create({
          data: {
            userId: user.id,
            name: spec.name,
            type: spec.type,
            currency: 'BDT',
            openingDate: dateOnly(openingDate),
            openingBalance: spec.opening,
            ledgerAccount: {
              create: { class: cls, normalBalance: normalBalanceFor(cls), name: spec.name },
            },
          },
          include: { ledgerAccount: true },
        });
        if (spec.opening !== '0') {
          await ledger.post(tx, {
            userId: user.id,
            kind: 'OPENING_BALANCE',
            currency: 'BDT',
            effectiveDate: openingDate,
            lines: openingBalanceLines({
              accountClass: cls,
              accountLedgerId: created.ledgerAccount!.id,
              openingEquityLedgerId: system('EQUITY_OPENING_BALANCE'),
              amount: parseMoney(spec.opening),
            }),
          });
        }
        return created;
      });
      accounts.push({ id: account.id, ledgerId: account.ledgerAccount!.id });
    }

    const categories = await prisma.category.findMany({
      where: { isSystem: true },
      select: { id: true, type: true },
    });
    const expenseCats = categories.filter((c) => c.type === 'EXPENSE');
    const incomeCats = categories.filter((c) => c.type === 'INCOME');
    const pick = <T>(items: readonly T[]) => items[randomInt(items.length)]!;
    const randomInstant = () =>
      new Date(start.getTime() + randomInt(now.getTime() - start.getTime() - 3_600_000));

    const BATCH = 200;
    for (let done = 0; done < TRANSACTIONS; done += BATCH) {
      await prisma.$transaction(
        async (tx) => {
          for (let i = done; i < Math.min(done + BATCH, TRANSACTIONS); i += 1) {
            const income = i % 12 === 0;
            const account = income ? accounts[1]! : pick(accounts);
            const amount = parseMoney(
              income
                ? String(randomInt(20_000, 90_000))
                : `${randomInt(20, 5_000)}.${randomInt(0, 99)}`,
            );
            const occurredAt = randomInstant();
            const effectiveDate = localDateOf(occurredAt, TZ);
            const journal = await ledger.post(tx, {
              userId: user.id,
              kind: income ? 'INCOME' : 'EXPENSE',
              currency: 'BDT',
              effectiveDate,
              lines: income
                ? incomeLines(account.ledgerId, system('INCOME'), amount)
                : expenseLines(system('EXPENSE'), account.ledgerId, amount),
            });
            await tx.transaction.create({
              data: {
                userId: user.id,
                journalEntryId: journal.id,
                type: income ? 'INCOME' : 'EXPENSE',
                amount: toMoneyString(amount),
                currency: 'BDT',
                accountId: account.id,
                categoryId: pick(income ? incomeCats : expenseCats).id,
                occurredAt,
                effectiveDate: dateOnly(effectiveDate),
                description: income ? 'Salary' : `Synthetic expense ${i}`,
              },
            });
          }
        },
        { timeout: 120_000 },
      );
      console.warn(`… ${Math.min(done + BATCH, TRANSACTIONS)} / ${TRANSACTIONS} transactions`);
    }

    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < 200; i += 1) {
          const source = accounts[1]!;
          const destination = pick([accounts[0]!, accounts[2]!, accounts[4]!]);
          const amount = parseMoney(String(randomInt(500, 10_000)));
          const occurredAt = randomInstant();
          const effectiveDate = localDateOf(occurredAt, TZ);
          const journal = await ledger.post(tx, {
            userId: user.id,
            kind: 'TRANSFER',
            currency: 'BDT',
            effectiveDate,
            lines: transferLines(source.ledgerId, destination.ledgerId, amount),
          });
          await tx.transfer.create({
            data: {
              userId: user.id,
              journalEntryId: journal.id,
              sourceAccountId: source.id,
              destinationAccountId: destination.id,
              amount: toMoneyString(amount),
              currency: 'BDT',
              occurredAt,
              effectiveDate: dateOnly(effectiveDate),
            },
          });
        }
      },
      { timeout: 120_000 },
    );
    console.warn(
      `Seeded ${EMAIL} / "${LOAD_TEST_PASSWORD}" with ${TRANSACTIONS} transactions and 200 transfers.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
