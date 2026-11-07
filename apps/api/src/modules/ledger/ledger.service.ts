import { Injectable } from '@nestjs/common';
import { balanceOf, validateJournalLines } from '../../domain/ledger/ledger-rules';
import { type PostingLine, reversalLines } from '../../domain/ledger/posting-templates';
import { money, type Money, toMoneyString, ZERO } from '../../domain/money/money';
import { dateOnly } from '../../domain/time/local-date';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { JournalKind, LedgerSystemCode, NormalBalance } from '../../generated/prisma/enums';

type Db = PrismaService | Prisma.TransactionClient;

const dateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

export type JournalDraft = {
  userId: string;
  kind: JournalKind;
  currency: string;
  effectiveDate: string;
  memo?: string;
  reversesId?: string;
  lines: PostingLine[];
};

/** A bug in a posting template — never a user error. */
export class UnbalancedJournalError extends Error {
  constructor(issues: string[]) {
    super(`Refusing to post invalid journal: ${issues.join(', ')}`);
    this.name = 'UnbalancedJournalError';
  }
}

/**
 * The only writer of journal entries (ADR-001/005). Callers pass a transaction
 * client so the journal commits atomically with the business record.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(tx: Prisma.TransactionClient, draft: JournalDraft): Promise<{ id: string }> {
    const issues = validateJournalLines(draft.lines);
    if (issues.length > 0) throw new UnbalancedJournalError(issues);

    return tx.journalEntry.create({
      data: {
        userId: draft.userId,
        kind: draft.kind,
        currency: draft.currency,
        effectiveDate: dateOnly(draft.effectiveDate),
        memo: draft.memo ?? null,
        reversesId: draft.reversesId ?? null,
        lines: {
          create: draft.lines.map((line) => ({
            ledgerAccountId: line.ledgerAccountId,
            debit: toMoneyString(line.debit),
            credit: toMoneyString(line.credit),
            currency: draft.currency,
          })),
        },
      },
      select: { id: true },
    });
  }

  /**
   * Posts the compensating REVERSAL of `journalEntryId`, dated like the original
   * (ADR-010). A second reversal fails on the unique `reverses_id` constraint.
   */
  async reverse(
    tx: Prisma.TransactionClient,
    userId: string,
    journalEntryId: string,
    memo?: string,
  ): Promise<{ id: string }> {
    const original = await tx.journalEntry.findFirstOrThrow({
      where: { id: journalEntryId, userId },
      include: { lines: true },
    });
    return this.post(tx, {
      userId,
      kind: 'REVERSAL',
      currency: original.currency,
      effectiveDate: original.effectiveDate.toISOString().slice(0, 10),
      memo,
      reversesId: original.id,
      lines: reversalLines(
        original.lines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          debit: money(l.debit),
          credit: money(l.credit),
        })),
      ),
    });
  }

  async systemAccountId(db: Db, userId: string, code: LedgerSystemCode): Promise<string> {
    const account = await db.ledgerAccount.findUniqueOrThrow({
      where: { userId_systemCode: { userId, systemCode: code } },
      select: { id: true },
    });
    return account.id;
  }

  /**
   * Ledger-derived balances in each account's natural sign (ADR-004). The ledger
   * is the source of truth; nothing is cached.
   */
  async balances(
    db: Db,
    accounts: ReadonlyArray<{ id: string; normalBalance: NormalBalance }>,
  ): Promise<Map<string, Money>> {
    const result = new Map<string, Money>(accounts.map((a) => [a.id, ZERO]));
    if (accounts.length === 0) return result;

    const sums = await db.journalLine.groupBy({
      by: ['ledgerAccountId'],
      where: { ledgerAccountId: { in: accounts.map((a) => a.id) } },
      _sum: { debit: true, credit: true },
    });
    const normalById = new Map(accounts.map((a) => [a.id, a.normalBalance]));
    for (const row of sums) {
      const normal = normalById.get(row.ledgerAccountId);
      if (!normal) continue;
      result.set(
        row.ledgerAccountId,
        balanceOf(normal, [{ debit: row._sum.debit ?? '0', credit: row._sum.credit ?? '0' }]),
      );
    }
    return result;
  }

  /**
   * Net movement per ledger account per effective date, in each account's
   * natural sign. Lets callers compute the balance on ANY date (net worth
   * history, valuation roll-forward) from one query instead of one per date.
   */
  async dailyMovements(
    db: Db,
    accounts: ReadonlyArray<{ id: string; normalBalance: NormalBalance }>,
  ): Promise<Map<string, Array<{ date: string; amount: Money }>>> {
    const result = new Map<string, Array<{ date: string; amount: Money }>>(
      accounts.map((a) => [a.id, []]),
    );
    if (accounts.length === 0) return result;
    // SUM(numeric) comes back as a Prisma Decimal (or null for no rows).
    type Sum = { toString(): string } | null;
    const rows = await db.$queryRaw<
      Array<{ ledger_account_id: string; effective_date: Date; debit: Sum; credit: Sum }>
    >`
      SELECT jl."ledger_account_id", je."effective_date",
             SUM(jl."debit") AS "debit", SUM(jl."credit") AS "credit"
        FROM "journal_lines" jl
        JOIN "journal_entries" je ON je."id" = jl."journal_entry_id"
       WHERE jl."ledger_account_id" = ANY(${accounts.map((a) => a.id)}::uuid[])
       GROUP BY jl."ledger_account_id", je."effective_date"
       ORDER BY je."effective_date"`;
    const normalById = new Map(accounts.map((a) => [a.id, a.normalBalance]));
    for (const row of rows) {
      const normal = normalById.get(row.ledger_account_id);
      if (!normal) continue;
      result.get(row.ledger_account_id)!.push({
        date: dateString(row.effective_date),
        amount: balanceOf(normal, [{ debit: row.debit ?? '0', credit: row.credit ?? '0' }]),
      });
    }
    return result;
  }
}
