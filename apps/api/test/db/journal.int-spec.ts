import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  connectTestDb,
  createTestAccount,
  createTestUser,
  dbError,
  postJournal,
  type TestAccount,
  type TestUser,
} from './fixtures';

/** ADR-005: the database refuses unbalanced, malformed or edited journals. */
describe('journal invariants (DB)', () => {
  let prisma: PrismaClient;
  let user: TestUser;
  let cash: TestAccount;

  beforeAll(async () => {
    prisma = connectTestDb();
    user = await createTestUser(prisma);
    cash = await createTestAccount(prisma, user.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts a balanced journal (cash food expense ৳500)', async () => {
    const entry = await postJournal(prisma, user.id, 'EXPENSE', [
      { ledgerAccountId: user.ledger.expense, debit: '500' },
      { ledgerAccountId: cash.ledgerAccountId, credit: '500' },
    ]);
    const lines = await prisma.journalLine.findMany({ where: { journalEntryId: entry.id } });
    expect(lines).toHaveLength(2);
  });

  it('accepts lines inserted separately inside one transaction (deferred check)', async () => {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          userId: user.id,
          kind: 'INCOME',
          currency: 'BDT',
          effectiveDate: new Date('2026-11-05'),
        },
      });
      await tx.journalLine.create({
        data: {
          journalEntryId: entry.id,
          ledgerAccountId: cash.ledgerAccountId,
          debit: '50000',
          currency: 'BDT',
        },
      });
      await tx.journalLine.create({
        data: {
          journalEntryId: entry.id,
          ledgerAccountId: user.ledger.income,
          credit: '50000',
          currency: 'BDT',
        },
      });
    });
  });

  it('rejects an unbalanced journal at commit and rolls everything back', async () => {
    const memo = `unbalanced-${Date.now()}`;
    const message = await dbError(
      prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: {
            userId: user.id,
            kind: 'EXPENSE',
            currency: 'BDT',
            effectiveDate: new Date('2026-11-05'),
            memo,
          },
        });
        await tx.journalLine.createMany({
          data: [
            {
              journalEntryId: entry.id,
              ledgerAccountId: user.ledger.expense,
              debit: '500',
              currency: 'BDT',
            },
            {
              journalEntryId: entry.id,
              ledgerAccountId: cash.ledgerAccountId,
              credit: '499.9999',
              currency: 'BDT',
            },
          ],
        });
      }),
    );
    expect(message).toMatch(/unbalanced/);
    expect(await prisma.journalEntry.count({ where: { memo } })).toBe(0);
  });

  it('rejects a journal with a single line', async () => {
    const message = await dbError(
      postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '1' },
      ]),
    );
    expect(message).toMatch(/at least 2 lines/);
  });

  it('rejects a journal entry with no lines', async () => {
    const message = await dbError(postJournal(prisma, user.id, 'EXPENSE', []));
    expect(message).toMatch(/at least 2 lines \(has 0\)/);
  });

  it('rejects a line with both debit and credit', async () => {
    const message = await dbError(
      postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '5', credit: '5' },
        { ledgerAccountId: cash.ledgerAccountId, debit: '5', credit: '5' },
      ]),
    );
    expect(message).toMatch(/journal_lines_one_sided_positive/);
  });

  it('rejects zero-amount lines', async () => {
    const message = await dbError(
      postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '0' },
        { ledgerAccountId: cash.ledgerAccountId, credit: '0' },
      ]),
    );
    expect(message).toMatch(/journal_lines_one_sided_positive/);
  });

  it('rejects lines in a different currency from the entry', async () => {
    const message = await dbError(
      postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '10', currency: 'USD' },
        { ledgerAccountId: cash.ledgerAccountId, credit: '10', currency: 'USD' },
      ]),
    );
    expect(message).toMatch(/currency other than BDT/);
  });

  it("rejects posting to another user's ledger account", async () => {
    const other = await createTestUser(prisma);
    const message = await dbError(
      postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: other.ledger.expense, debit: '10' },
        { ledgerAccountId: cash.ledgerAccountId, credit: '10' },
      ]),
    );
    expect(message).toMatch(/ledger accounts of another user/);
  });

  describe('immutability', () => {
    let entryId: string;

    beforeAll(async () => {
      const entry = await postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '100' },
        { ledgerAccountId: cash.ledgerAccountId, credit: '100' },
      ]);
      entryId = entry.id;
    });

    it('blocks updating a journal line', async () => {
      const line = await prisma.journalLine.findFirstOrThrow({
        where: { journalEntryId: entryId },
      });
      const message = await dbError(
        prisma.journalLine.update({ where: { id: line.id }, data: { debit: '1' } }),
      );
      expect(message).toMatch(/immutable/);
    });

    it('blocks deleting a journal line', async () => {
      const message = await dbError(
        prisma.journalLine.deleteMany({ where: { journalEntryId: entryId } }),
      );
      expect(message).toMatch(/immutable/);
    });

    it('blocks updating or deleting a journal entry', async () => {
      expect(
        await dbError(
          prisma.journalEntry.update({ where: { id: entryId }, data: { memo: 'edited' } }),
        ),
      ).toMatch(/immutable/);
      expect(await dbError(prisma.journalEntry.delete({ where: { id: entryId } }))).toMatch(
        /immutable|Restrict|foreign key/i,
      );
    });
  });

  describe('reversals', () => {
    let originalId: string;

    beforeAll(async () => {
      const original = await postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '250' },
        { ledgerAccountId: cash.ledgerAccountId, credit: '250' },
      ]);
      originalId = original.id;
    });

    const mirror = () => [
      { ledgerAccountId: user.ledger.expense, credit: '250' },
      { ledgerAccountId: cash.ledgerAccountId, debit: '250' },
    ];

    it('accepts a compensating reversal', async () => {
      const reversal = await postJournal(prisma, user.id, 'REVERSAL', mirror(), {
        reversesId: originalId,
      });
      expect(reversal.reversesId).toBe(originalId);
    });

    it('rejects a second reversal of the same entry', async () => {
      const message = await dbError(
        postJournal(prisma, user.id, 'REVERSAL', mirror(), { reversesId: originalId }),
      );
      expect(message).toMatch(/Unique constraint|reverses_id/);
    });

    it('rejects reversing a reversal', async () => {
      const reversal = await prisma.journalEntry.findUniqueOrThrow({
        where: { reversesId: originalId },
      });
      const message = await dbError(
        postJournal(
          prisma,
          user.id,
          'REVERSAL',
          [
            { ledgerAccountId: user.ledger.expense, debit: '250' },
            { ledgerAccountId: cash.ledgerAccountId, credit: '250' },
          ],
          { reversesId: reversal.id },
        ),
      );
      expect(message).toMatch(/itself a reversal/);
    });

    it('requires reverses_id exactly for REVERSAL entries', async () => {
      expect(await dbError(postJournal(prisma, user.id, 'REVERSAL', mirror()))).toMatch(
        /journal_entries_reversal_link/,
      );
    });

    it("rejects reversing another user's entry", async () => {
      const victimEntry = await postJournal(prisma, user.id, 'EXPENSE', [
        { ledgerAccountId: user.ledger.expense, debit: '250' },
        { ledgerAccountId: cash.ledgerAccountId, credit: '250' },
      ]);
      const other = await createTestUser(prisma);
      const otherCash = await createTestAccount(prisma, other.id);
      const message = await dbError(
        postJournal(
          prisma,
          other.id,
          'REVERSAL',
          [
            { ledgerAccountId: other.ledger.expense, credit: '250' },
            { ledgerAccountId: otherCash.ledgerAccountId, debit: '250' },
          ],
          { reversesId: victimEntry.id },
        ),
      );
      expect(message).toMatch(/foreign key|journal_entries_reverses_id_user_id_fkey/i);
    });
  });
});
