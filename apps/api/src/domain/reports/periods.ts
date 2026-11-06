import { monthRange } from '../planning/budget-math';

/** Months from `from` to `to` inclusive (YYYY-MM). */
export function monthsBetween(from: string, to: string): string[] {
  const parse = (m: string) => {
    const [y, mm] = m.split('-');
    return Number.parseInt(y!, 10) * 12 + Number.parseInt(mm!, 10) - 1;
  };
  const result: string[] = [];
  for (let i = parse(from); i <= parse(to); i += 1) {
    result.push(`${(i - (i % 12)) / 12}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return result;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map((p) => Number.parseInt(p, 10)) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  // Both are UTC midnights, so the difference is an exact multiple of a day.
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

export { monthRange };
