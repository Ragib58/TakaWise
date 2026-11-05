import type { LedgerAccountClass } from '../../generated/prisma/enums';
import { type Money, ZERO } from '../money/money';

/**
 * Pure posting rules (implementation-plan §5.2). Every template returns balanced
 * two-sided lines; LedgerService validates again before writing, and the
 * database checks once more at COMMIT (ADR-005).
 */
export type PostingLine = { ledgerAccountId: string; debit: Money; credit: Money };

const dr = (ledgerAccountId: string, amount: Money): PostingLine => ({
  ledgerAccountId,
  debit: amount,
  credit: ZERO,
});
const cr = (ledgerAccountId: string, amount: Money): PostingLine => ({
  ledgerAccountId,
  debit: ZERO,
  credit: amount,
});

/**
 * Opening balance:
 *   asset (money held)        Dr Asset        / Cr Opening equity
 *   liability (card, owed)    Dr Opening eq.  / Cr Liability
 */
export function openingBalanceLines(args: {
  accountClass: LedgerAccountClass;
  accountLedgerId: string;
  openingEquityLedgerId: string;
  amount: Money;
}): PostingLine[] {
  const { accountClass, accountLedgerId, openingEquityLedgerId, amount } = args;
  return accountClass === 'LIABILITY'
    ? [dr(openingEquityLedgerId, amount), cr(accountLedgerId, amount)]
    : [dr(accountLedgerId, amount), cr(openingEquityLedgerId, amount)];
}

/** Income into an account: Dr account / Cr Income (for a card, this reduces what is owed). */
export function incomeLines(
  accountLedgerId: string,
  incomeLedgerId: string,
  amount: Money,
): PostingLine[] {
  return [dr(accountLedgerId, amount), cr(incomeLedgerId, amount)];
}

/** Expense paid from an account: Dr Expense / Cr account (for a card, this increases what is owed). */
export function expenseLines(
  expenseLedgerId: string,
  accountLedgerId: string,
  amount: Money,
): PostingLine[] {
  return [dr(expenseLedgerId, amount), cr(accountLedgerId, amount)];
}

/**
 * Transfer source → destination: Dr destination / Cr source. Never touches the
 * Income/Expense accounts (TRX-03). Paying a card from a bank is a transfer.
 */
export function transferLines(
  sourceLedgerId: string,
  destinationLedgerId: string,
  amount: Money,
): PostingLine[] {
  return [dr(destinationLedgerId, amount), cr(sourceLedgerId, amount)];
}

/** Compensating entry: every line with debit and credit swapped (ADR-010). */
export function reversalLines(original: readonly PostingLine[]): PostingLine[] {
  return original.map((line) => ({
    ledgerAccountId: line.ledgerAccountId,
    debit: line.credit,
    credit: line.debit,
  }));
}
