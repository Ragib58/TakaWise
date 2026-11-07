import type {
  FinancialAccountType,
  LedgerAccountClass,
  LedgerSystemCode,
  NormalBalance,
} from '../../generated/prisma/enums';
import { money, type Money, type MoneyInput, sumMoney, ZERO } from '../money/money';

/**
 * Central normal-balance rules (ADR-004). The database enforces the same mapping
 * with CHECK constraints; keep both in sync.
 */
export const NORMAL_BALANCE_BY_CLASS: Readonly<Record<LedgerAccountClass, NormalBalance>> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

export function normalBalanceFor(cls: LedgerAccountClass): NormalBalance {
  return NORMAL_BALANCE_BY_CLASS[cls];
}

/** Account types that represent money owed (ADR-008, ADR-022). Mirrored by a DB trigger. */
const LIABILITY_ACCOUNT_TYPES: ReadonlySet<FinancialAccountType> = new Set([
  'CREDIT_CARD_TRACKING',
  'LOAN',
]);

/** Credit cards and borrowed loans are liabilities; every other account type is an asset. */
export function ledgerClassForAccountType(type: FinancialAccountType): 'ASSET' | 'LIABILITY' {
  return LIABILITY_ACCOUNT_TYPES.has(type) ? 'LIABILITY' : 'ASSET';
}

/**
 * Account types managed by the wealth modules (Phase 8). They are created only
 * through /investments and /loans so their detail record always exists.
 */
export const WEALTH_ACCOUNT_TYPES: ReadonlySet<FinancialAccountType> = new Set([
  'INVESTMENT',
  'LOAN',
  'LOAN_RECEIVABLE',
]);

export type LineAmounts = { debit: MoneyInput; credit: MoneyInput };

/**
 * Balance in the account's natural sign:
 *   debit-normal  = Σdebit − Σcredit
 *   credit-normal = Σcredit − Σdebit
 * A positive result means "has money" for assets and "owes money" for liabilities.
 */
export function balanceOf(normal: NormalBalance, lines: Iterable<LineAmounts>): Money {
  let debit = ZERO;
  let credit = ZERO;
  for (const line of lines) {
    debit = debit.plus(money(line.debit));
    credit = credit.plus(money(line.credit));
  }
  return normal === 'DEBIT' ? debit.minus(credit) : credit.minus(debit);
}

export type JournalValidationIssue =
  'TOO_FEW_LINES' | 'LINE_NOT_ONE_SIDED' | 'LINE_NOT_POSITIVE' | 'UNBALANCED';

export type DraftLine = { debit: Money; credit: Money };

/**
 * Pure pre-check used by the posting service before touching the database
 * (mirrors the DB CHECK + deferred trigger). Returns the issues found.
 */
export function validateJournalLines(lines: readonly DraftLine[]): JournalValidationIssue[] {
  const issues = new Set<JournalValidationIssue>();
  if (lines.length < 2) issues.add('TOO_FEW_LINES');

  for (const { debit, credit } of lines) {
    if (debit.isNegative() || credit.isNegative()) issues.add('LINE_NOT_POSITIVE');
    const debitSide = debit.greaterThan(0);
    const creditSide = credit.greaterThan(0);
    if (debitSide === creditSide) {
      issues.add(debitSide ? 'LINE_NOT_ONE_SIDED' : 'LINE_NOT_POSITIVE');
    }
  }

  const totalDebit = sumMoney(lines.map((l) => l.debit));
  const totalCredit = sumMoney(lines.map((l) => l.credit));
  if (!totalDebit.equals(totalCredit)) issues.add('UNBALANCED');

  return [...issues];
}

/** Per-user system ledger accounts created at registration (ADR-007). */
export const SYSTEM_LEDGER_ACCOUNTS: ReadonlyArray<{
  code: LedgerSystemCode;
  class: LedgerAccountClass;
  nameEn: string;
  nameBn: string;
}> = [
  {
    code: 'EQUITY_OPENING_BALANCE',
    class: 'EQUITY',
    nameEn: 'Opening balance equity',
    nameBn: 'প্রারম্ভিক ব্যালেন্স ইকুইটি',
  },
  { code: 'INCOME', class: 'INCOME', nameEn: 'Income', nameBn: 'আয়' },
  { code: 'EXPENSE', class: 'EXPENSE', nameEn: 'Expenses', nameBn: 'ব্যয়' },
];
