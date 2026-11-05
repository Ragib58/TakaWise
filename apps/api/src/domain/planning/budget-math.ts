import { type Money, toMoneyString, ZERO } from '../money/money';

/** BUD-02 thresholds. */
export const WARNING_RATIO = '0.8';

export type UtilizationResult = {
  limit: string;
  spent: string;
  remaining: string;
  percentUsed: string;
  status: 'ok' | 'warning' | 'over';
};

/** spent vs limit, computed in Decimal. percentUsed is rounded half-even to 2 dp. */
export function utilization(limit: Money, spent: Money): UtilizationResult {
  const ratio = limit.isZero() ? ZERO : spent.div(limit);
  const status = ratio.greaterThan(1)
    ? 'over'
    : ratio.greaterThanOrEqualTo(WARNING_RATIO)
      ? 'warning'
      : 'ok';
  return {
    limit: toMoneyString(limit),
    spent: toMoneyString(spent),
    remaining: toMoneyString(limit.minus(spent)),
    percentUsed: ratio.times(100).toFixed(2),
    status,
  };
}

/** First and last calendar day of a YYYY-MM month (inclusive), as ISO dates. */
export function monthRange(month: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Invalid month: ${month}`);
  const year = Number.parseInt(match[1]!, 10);
  const monthIndex = Number.parseInt(match[2]!, 10) - 1;
  // Day 0 of the next month is the last day of this month (UTC; no time-zone shift).
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Spending attributed to each budgeted category, including its sub-categories
 * (a limit on "Utilities" covers electricity, gas and water).
 */
export function rollUpSpending(
  budgetCategoryIds: readonly string[],
  spentByCategory: ReadonlyMap<string, Money>,
  parentOf: ReadonlyMap<string, string | null>,
): Map<string, Money> {
  const result = new Map<string, Money>(budgetCategoryIds.map((id) => [id, ZERO]));
  for (const [categoryId, amount] of spentByCategory) {
    if (result.has(categoryId)) result.set(categoryId, result.get(categoryId)!.plus(amount));
    const parent = parentOf.get(categoryId);
    if (parent && result.has(parent)) result.set(parent, result.get(parent)!.plus(amount));
  }
  return result;
}
