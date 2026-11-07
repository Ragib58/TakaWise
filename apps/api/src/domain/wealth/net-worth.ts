import type { FinancialAccountType } from '../../generated/prisma/enums';
import { type Money, sumMoney } from '../money/money';

/**
 * Net worth = assets − liabilities, per currency (ADR-016, ADR-023). Pure and
 * deterministic so it can be unit tested and recomputed for any date.
 *
 * Avoiding double counting:
 *  - Every account (cash, bank, card, investment, loan) is counted exactly once,
 *    at its ledger balance on the date ("RECORDED").
 *  - An investment with a valuation is counted at that valuation INSTEAD of its
 *    ledger balance, rolled forward by money moved in or out after the
 *    valuation date — never both.
 *  - Net-worth items are things that are not accounts (a flat, a car); they
 *    only ever have valuations, so they cannot overlap an account.
 */

export type NetWorthGroup =
  | 'CASH_AND_ACCOUNTS'
  | 'INVESTMENTS'
  | 'MONEY_LENT'
  | 'OTHER_ASSETS'
  | 'CREDIT_CARDS'
  | 'LOANS'
  | 'OTHER_LIABILITIES';

export type ValueBasis = 'RECORDED' | 'USER_ENTERED' | 'ESTIMATED' | 'VERIFIED';
export type Side = 'ASSET' | 'LIABILITY';

export type DatedValue = { date: string; value: Money; source: Exclude<ValueBasis, 'RECORDED'> };

export type AccountInput = {
  id: string;
  name: string;
  type: FinancialAccountType;
  side: Side;
  currency: string;
  openedOn: string;
  archived: boolean;
  /** Net ledger movement per day in the account's natural sign (any order). */
  movements: ReadonlyArray<{ date: string; amount: Money }>;
  /** Investments only. */
  valuations?: readonly DatedValue[];
};

export type ItemInput = {
  id: string;
  name: string;
  side: Side;
  currency: string;
  /** Local date the item was archived (sold/settled); not counted from then on. */
  archivedOn: string | null;
  valuations: readonly DatedValue[];
};

export type NetWorthLine = {
  source: 'ACCOUNT' | 'ITEM';
  id: string;
  name: string;
  type: FinancialAccountType | null;
  group: NetWorthGroup;
  side: Side;
  currency: string;
  value: Money;
  /** Ledger balance on the date (accounts only). */
  recorded: Money | null;
  basis: ValueBasis;
  /** Date of the valuation used, if any. */
  valuedOn: string | null;
};

export type CurrencyNetWorth = {
  currency: string;
  assets: Money;
  liabilities: Money;
  netWorth: Money;
  groups: Array<{ group: NetWorthGroup; side: Side; total: Money }>;
  lines: NetWorthLine[];
};

const GROUP_ORDER: readonly NetWorthGroup[] = [
  'CASH_AND_ACCOUNTS',
  'INVESTMENTS',
  'MONEY_LENT',
  'OTHER_ASSETS',
  'CREDIT_CARDS',
  'LOANS',
  'OTHER_LIABILITIES',
];

export function groupForAccountType(type: FinancialAccountType): NetWorthGroup {
  switch (type) {
    case 'INVESTMENT':
      return 'INVESTMENTS';
    case 'LOAN_RECEIVABLE':
      return 'MONEY_LENT';
    case 'CREDIT_CARD_TRACKING':
      return 'CREDIT_CARDS';
    case 'LOAN':
      return 'LOANS';
    default:
      return 'CASH_AND_ACCOUNTS';
  }
}

/** Σ movements dated on or before `date`. */
export function bookValueAsOf(
  movements: ReadonlyArray<{ date: string; amount: Money }>,
  date: string,
): Money {
  return sumMoney(movements.filter((m) => m.date <= date).map((m) => m.amount));
}

/** Latest valuation on or before `date` (ties impossible: one per date). */
export function latestValuation(
  valuations: readonly DatedValue[],
  date: string,
): DatedValue | null {
  let best: DatedValue | null = null;
  for (const v of valuations) {
    if (v.date <= date && (!best || v.date > best.date)) best = v;
  }
  return best;
}

/**
 * Value of an account on `asOf`: its latest valuation rolled forward by
 * contributions/withdrawals after the valuation date (so a top-up after the
 * last valuation is neither lost nor counted twice), else its ledger balance.
 */
export function accountValueAsOf(
  movements: AccountInput['movements'],
  valuations: readonly DatedValue[] | undefined,
  asOf: string,
): { value: Money; recorded: Money; valuation: DatedValue | null } {
  const recorded = bookValueAsOf(movements, asOf);
  const valuation = valuations ? latestValuation(valuations, asOf) : null;
  const value = valuation
    ? valuation.value.plus(recorded.minus(bookValueAsOf(movements, valuation.date)))
    : recorded;
  return { value, recorded, valuation };
}

function accountLine(account: AccountInput, asOf: string): NetWorthLine | null {
  if (account.openedOn > asOf) return null;
  const { value, recorded, valuation } = accountValueAsOf(
    account.movements,
    account.valuations,
    asOf,
  );
  if (account.archived && value.isZero()) return null;
  return {
    source: 'ACCOUNT',
    id: account.id,
    name: account.name,
    type: account.type,
    group: groupForAccountType(account.type),
    side: account.side,
    currency: account.currency,
    value,
    recorded,
    basis: valuation ? valuation.source : 'RECORDED',
    valuedOn: valuation?.date ?? null,
  };
}

function itemLine(item: ItemInput, asOf: string): NetWorthLine | null {
  if (item.archivedOn && item.archivedOn <= asOf) return null;
  const valuation = latestValuation(item.valuations, asOf);
  if (!valuation) return null;
  return {
    source: 'ITEM',
    id: item.id,
    name: item.name,
    type: null,
    group: item.side === 'ASSET' ? 'OTHER_ASSETS' : 'OTHER_LIABILITIES',
    side: item.side,
    currency: item.currency,
    value: valuation.value,
    recorded: null,
    basis: valuation.source,
    valuedOn: valuation.date,
  };
}

export function computeNetWorth(args: {
  asOf: string;
  accounts: readonly AccountInput[];
  items: readonly ItemInput[];
}): CurrencyNetWorth[] {
  const lines = [
    ...args.accounts.map((a) => accountLine(a, args.asOf)),
    ...args.items.map((i) => itemLine(i, args.asOf)),
  ].filter((l): l is NetWorthLine => l !== null);

  const byCurrency = new Map<string, NetWorthLine[]>();
  for (const line of lines) {
    byCurrency.set(line.currency, [...(byCurrency.get(line.currency) ?? []), line]);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, currencyLines]) => {
      const total = (side: Side) =>
        sumMoney(currencyLines.filter((l) => l.side === side).map((l) => l.value));
      const assets = total('ASSET');
      const liabilities = total('LIABILITY');
      const groups = GROUP_ORDER.flatMap((group) => {
        const inGroup = currencyLines.filter((l) => l.group === group);
        if (inGroup.length === 0) return [];
        return [{ group, side: inGroup[0]!.side, total: sumMoney(inGroup.map((l) => l.value)) }];
      });
      currencyLines.sort(
        (a, b) =>
          GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
          a.name.localeCompare(b.name),
      );
      return {
        currency,
        assets,
        liabilities,
        netWorth: assets.minus(liabilities),
        groups,
        lines: currencyLines,
      };
    });
}

/** Month-end dates for the `months` months ending with `asOf`'s month; the last point is `asOf` itself. */
export function historyDates(asOf: string, months: number): string[] {
  const [y, m] = asOf.split('-').map(Number) as [number, number];
  const dates: string[] = [];
  for (let i = months - 1; i >= 1; i--) {
    // Day 0 of the following month = last day of the month `i` months ago.
    dates.push(new Date(Date.UTC(y, m - i, 0)).toISOString().slice(0, 10));
  }
  dates.push(asOf);
  return dates;
}
