import { money, type Money, type MoneyInput, toMoneyString, ZERO } from '../money/money';

export type ContributionEntry = {
  kind: 'CONTRIBUTION' | 'WITHDRAWAL' | 'REVERSAL';
  status: 'POSTED' | 'REVERSED';
  amount: MoneyInput;
};

/**
 * Goal progress comes ONLY from contribution history (GOAL-02, ADR-009):
 * Σ contributions − Σ withdrawals over entries that are still POSTED. A
 * reversed entry and its REVERSAL row cancel out by both being excluded.
 */
export function savedAmount(entries: Iterable<ContributionEntry>): Money {
  let saved = ZERO;
  for (const e of entries) {
    if (e.status !== 'POSTED' || e.kind === 'REVERSAL') continue;
    saved = e.kind === 'CONTRIBUTION' ? saved.plus(money(e.amount)) : saved.minus(money(e.amount));
  }
  return saved;
}

export function goalProgress(target: Money, saved: Money) {
  const remaining = target.minus(saved);
  return {
    saved: toMoneyString(saved),
    remaining: toMoneyString(remaining.isNegative() ? ZERO : remaining),
    percent: (target.isZero() ? ZERO : saved.div(target).times(100)).toFixed(2),
    achieved: saved.greaterThanOrEqualTo(target),
  };
}

/** Money in the account not yet set aside for any goal (never below zero). */
export function unallocated(accountBalance: Money, earmarkedTotal: Money): Money {
  const free = accountBalance.minus(earmarkedTotal);
  return free.isNegative() ? ZERO : free;
}
