import type { PrismaClient } from '../../src/generated/prisma/client';
import type { TransactionType } from '../../src/generated/prisma/enums';
import {
  connectTestDb,
  createTestAccount,
  createTestUser,
  dbError,
  postJournal,
  systemCategoryId,
  type TestAccount,
  type TestUser,
} from './fixtures';

const DATE = new Date('2026-11-05');

describe('accounts, transactions and transfers (DB)', () => {
  let prisma: PrismaClient;
  let user: TestUser;
  let cash: TestAccount;
  let bank: TestAccount;
  let foodId: string;
  let salaryId: string;

  beforeAll(async () => {
    prisma = connectTestDb();
    user = await createTestUser(prisma);
    cash = await createTestAccount(prisma, user.id, { type: 'CASH' });
    bank = await createTestAccount(prisma, user.id, { type: 'BANK' });
    foodId = await systemCategoryId(prisma, 'expense.food');
    salaryId = await systemCategoryId(prisma, 'income.salary');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Journal + transaction row for `owner`, all inside one DB transaction. */
  function recordTransaction(args: {
    owner: TestUser;
    account: TestAccount;
    type: TransactionType;
    categoryId: string;
    amount?: string;
    journalKind?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    accountIdOverride?: string;
  }) {
    const amount = args.amount ?? '500';
    const lines =
      args.type === 'EXPENSE'
        ? [
            { ledgerAccountId: args.owner.ledger.expense, debit: amount },
            { ledgerAccountId: args.account.ledgerAccountId, credit: amount },
          ]
        : [
            { ledgerAccountId: args.account.ledgerAccountId, debit: amount },
            { ledgerAccountId: args.owner.ledger.income, credit: amount },
          ];
    return prisma.$transaction(async (tx) => {
      const journal = await postJournal(tx, args.owner.id, args.journalKind ?? args.type, lines);
      return tx.transaction.create({
        data: {
          userId: args.owner.id,
          journalEntryId: journal.id,
          type: args.type,
          amount,
          currency: 'BDT',
          accountId: args.accountIdOverride ?? args.account.id,
          categoryId: args.categoryId,
          occurredAt: new Date('2026-11-05T06:30:00Z'),
          effectiveDate: DATE,
          description: 'Lunch',
        },
      });
    });
  }

  describe('financial accounts', () => {
    it('rejects a negative opening balance', async () => {
      const message = await dbError(
        prisma.financialAccount.create({
          data: {
            userId: user.id,
            name: 'Overdrawn',
            type: 'BANK',
            currency: 'BDT',
            openingDate: DATE,
            openingBalance: '-1',
          },
        }),
      );
      expect(message).toMatch(/financial_accounts_opening_balance_non_negative/);
    });

    it('rejects duplicate active names case-insensitively but allows reuse after archiving', async () => {
      await createTestAccount(prisma, user.id, { name: 'bKash Personal' });
      expect(await dbError(createTestAccount(prisma, user.id, { name: 'BKASH personal' }))).toMatch(
        /financial_accounts_user_active_name_key|Unique constraint/,
      );

      await prisma.financialAccount.updateMany({
        where: { userId: user.id, name: 'bKash Personal' },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await expect(
        createTestAccount(prisma, user.id, { name: 'bKash Personal' }),
      ).resolves.toBeDefined();
    });

    it('rejects a lower-case currency code', async () => {
      expect(await dbError(createTestAccount(prisma, user.id, { currency: 'bdt' }))).toMatch(
        /financial_accounts_currency_iso/,
      );
    });

    it('rejects mapping a credit card to an ASSET ledger account (ADR-008)', async () => {
      const message = await dbError(
        prisma.financialAccount.create({
          data: {
            userId: user.id,
            name: 'Visa',
            type: 'CREDIT_CARD_TRACKING',
            currency: 'BDT',
            openingDate: DATE,
            ledgerAccount: { create: { class: 'ASSET', normalBalance: 'DEBIT', name: 'wrong' } },
          },
        }),
      );
      expect(message).toMatch(/must map to a LIABILITY ledger account/);
    });

    it('rejects a ledger account whose normal balance contradicts its class', async () => {
      const message = await dbError(
        prisma.financialAccount.create({
          data: {
            userId: user.id,
            name: 'Wallet',
            type: 'MOBILE_WALLET',
            currency: 'BDT',
            openingDate: DATE,
            ledgerAccount: { create: { class: 'ASSET', normalBalance: 'CREDIT', name: 'wrong' } },
          },
        }),
      );
      expect(message).toMatch(/ledger_accounts_normal_balance_matches_class/);
    });

    it('rejects a credit limit on a non-card account', async () => {
      const message = await dbError(
        prisma.financialAccount.create({
          data: {
            userId: user.id,
            name: 'Cash 2',
            type: 'CASH',
            currency: 'BDT',
            openingDate: DATE,
            creditLimit: '1000',
          },
        }),
      );
      expect(message).toMatch(/financial_accounts_credit_limit_card_only/);
    });
  });

  describe('transactions', () => {
    it('records an expense with a system category', async () => {
      const trx = await recordTransaction({
        owner: user,
        account: cash,
        type: 'EXPENSE',
        categoryId: foodId,
      });
      expect(trx.status).toBe('POSTED');
      expect(trx.amount.toString()).toBe('500');
    });

    it("rejects using another user's account (composite FK)", async () => {
      const other = await createTestUser(prisma);
      const message = await dbError(
        recordTransaction({ owner: other, account: cash, type: 'EXPENSE', categoryId: foodId }),
      );
      // Their journal posts to our ledger account â†’ rejected by FK or the owner check.
      expect(message).toMatch(/foreign key|another user/i);
    });

    it("rejects using another user's account even with the owner's own ledger lines", async () => {
      const other = await createTestUser(prisma);
      const otherCash = await createTestAccount(prisma, other.id);
      const message = await dbError(
        recordTransaction({
          owner: other,
          account: otherCash,
          accountIdOverride: cash.id,
          type: 'EXPENSE',
          categoryId: foodId,
        }),
      );
      expect(message).toMatch(/transactions_account_id_user_id_fkey|foreign key/i);
    });

    it("rejects another user's custom category", async () => {
      const other = await createTestUser(prisma);
      const theirs = await prisma.category.create({
        data: { userId: other.id, type: 'EXPENSE', nameEn: 'Theirs', nameBn: 'à¦¤à¦¾à¦¦à§‡à¦°' },
      });
      const message = await dbError(
        recordTransaction({ owner: user, account: cash, type: 'EXPENSE', categoryId: theirs.id }),
      );
      expect(message).toMatch(/category belongs to another user/);
    });

    it('rejects an income category on an expense', async () => {
      const message = await dbError(
        recordTransaction({ owner: user, account: cash, type: 'EXPENSE', categoryId: salaryId }),
      );
      expect(message).toMatch(/category type INCOME does not match EXPENSE/);
    });

    it('rejects a journal of the wrong kind', async () => {
      const message = await dbError(
        recordTransaction({
          owner: user,
          account: cash,
          type: 'EXPENSE',
          categoryId: foodId,
          journalKind: 'INCOME',
        }),
      );
      expect(message).toMatch(/must reference a EXPENSE journal entry/);
    });

    it('rejects a non-positive amount', async () => {
      const message = await dbError(
        prisma.$transaction(async (tx) => {
          const journal = await postJournal(tx, user.id, 'EXPENSE', [
            { ledgerAccountId: user.ledger.expense, debit: '1' },
            { ledgerAccountId: cash.ledgerAccountId, credit: '1' },
          ]);
          await tx.transaction.create({
            data: {
              userId: user.id,
              journalEntryId: journal.id,
              type: 'EXPENSE',
              amount: '0',
              currency: 'BDT',
              accountId: cash.id,
              categoryId: foodId,
              occurredAt: new Date(),
              effectiveDate: DATE,
            },
          });
        }),
      );
      expect(message).toMatch(/transactions_amount_positive/);
    });

    describe('posted transaction immutability', () => {
      let trxId: string;
      let journalId: string;

      beforeAll(async () => {
        const trx = await recordTransaction({
          owner: user,
          account: bank,
          type: 'INCOME',
          categoryId: salaryId,
          amount: '50000',
        });
        trxId = trx.id;
        journalId = trx.journalEntryId;
      });

      it('blocks changing the amount', async () => {
        expect(
          await dbError(prisma.transaction.update({ where: { id: trxId }, data: { amount: '1' } })),
        ).toMatch(/financial fields .* are immutable/);
      });

      it('blocks changing the account or date', async () => {
        expect(
          await dbError(
            prisma.transaction.update({
              where: { id: trxId },
              data: { effectiveDate: new Date('2026-01-01') },
            }),
          ),
        ).toMatch(/immutable/);
      });

      it('blocks deleting', async () => {
        expect(await dbError(prisma.transaction.delete({ where: { id: trxId } }))).toMatch(
          /post a reversal instead/,
        );
      });

      it('allows editing the free-text description', async () => {
        const updated = await prisma.transaction.update({
          where: { id: trxId },
          data: { description: 'November salary' },
        });
        expect(updated.description).toBe('November salary');
      });

      it('rejects marking REVERSED with an unrelated journal', async () => {
        const unrelated = await postJournal(prisma, user.id, 'INCOME', [
          { ledgerAccountId: bank.ledgerAccountId, debit: '1' },
          { ledgerAccountId: user.ledger.income, credit: '1' },
        ]);
        const message = await dbError(
          prisma.transaction.update({
            where: { id: trxId },
            data: {
              status: 'REVERSED',
              reversalJournalEntryId: unrelated.id,
              reversedAt: new Date(),
            },
          }),
        );
        expect(message).toMatch(/must be the REVERSAL entry of this record/);
      });

      it('allows POSTED â†’ REVERSED with its own reversal journal, then freezes it', async () => {
        await prisma.$transaction(async (tx) => {
          const reversal = await postJournal(
            tx,
            user.id,
            'REVERSAL',
            [
              { ledgerAccountId: bank.ledgerAccountId, credit: '50000' },
              { ledgerAccountId: user.ledger.income, debit: '50000' },
            ],
            { reversesId: journalId },
          );
          await tx.transaction.update({
            where: { id: trxId },
            data: {
              status: 'REVERSED',
              reversalJournalEntryId: reversal.id,
              reversedAt: new Date(),
            },
          });
        });

        expect(
          await dbError(
            prisma.transaction.update({ where: { id: trxId }, data: { status: 'POSTED' } }),
          ),
        ).toMatch(/already reversed|transactions_reversal_consistent/);
      });

      it('requires reversal fields to be set together (CHECK)', async () => {
        const trx = await recordTransaction({
          owner: user,
          account: cash,
          type: 'EXPENSE',
          categoryId: foodId,
        });
        expect(
          await dbError(
            prisma.transaction.update({ where: { id: trx.id }, data: { status: 'REVERSED' } }),
          ),
        ).toMatch(/transactions_reversal_consistent|REVERSAL entry/);
      });
    });
  });

  describe('transfers', () => {
    function recordTransfer(source: TestAccount, destination: TestAccount, currency = 'BDT') {
      return prisma.$transaction(async (tx) => {
        const journal = await postJournal(
          tx,
          user.id,
          'TRANSFER',
          [
            { ledgerAccountId: destination.ledgerAccountId, debit: '5000' },
            { ledgerAccountId: source.ledgerAccountId, credit: '5000' },
          ],
          { currency },
        );
        return tx.transfer.create({
          data: {
            userId: user.id,
            journalEntryId: journal.id,
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            amount: '5000',
            currency,
            occurredAt: new Date(),
            effectiveDate: DATE,
          },
        });
      });
    }

    it('records a same-currency transfer between two accounts', async () => {
      await expect(recordTransfer(cash, bank)).resolves.toMatchObject({ status: 'POSTED' });
    });

    it('rejects a transfer to the same account', async () => {
      expect(await dbError(recordTransfer(cash, cash))).toMatch(/transfers_distinct_accounts/);
    });

    it('rejects a cross-currency transfer (ADR-016)', async () => {
      const usd = await createTestAccount(prisma, user.id, { currency: 'USD' });
      const message = await dbError(
        prisma.$transaction(async (tx) => {
          const journal = await postJournal(tx, user.id, 'TRANSFER', [
            { ledgerAccountId: usd.ledgerAccountId, debit: '50' },
            { ledgerAccountId: cash.ledgerAccountId, credit: '50' },
          ]);
          await tx.transfer.create({
            data: {
              userId: user.id,
              journalEntryId: journal.id,
              sourceAccountId: cash.id,
              destinationAccountId: usd.id,
              amount: '50',
              currency: 'BDT',
              occurredAt: new Date(),
              effectiveDate: DATE,
            },
          });
        }),
      );
      expect(message).toMatch(/share one currency/);
    });
  });
});
