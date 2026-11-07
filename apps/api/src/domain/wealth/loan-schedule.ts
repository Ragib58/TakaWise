import { type Money, MoneyDecimal, ZERO } from '../money/money';

/**
 * Loan schedule math (Phase 8, ADR-022). Everything here is an ESTIMATE from
 * the terms the user typed in; the lender's own statement is authoritative.
 * Standard reducing-balance EMI with monthly compounding:
 *
 *   r   = annual rate / 12 / 100
 *   EMI = P · r · (1 + r)^n / ((1 + r)^n − 1)      (r > 0)
 *   EMI = P / n                                    (r = 0)
 *
 * Instalments are rounded to whole paisa (2 dp, half-up); the last instalment
 * absorbs rounding so the schedule always ends at exactly zero.
 */

export type LoanTerms = {
  principal: Money;
  /** Annual rate in percent, e.g. 9.5. */
  annualRatePct: Money;
  termMonths: number;
  /** ISO date of the first instalment. */
  firstPaymentDate: string;
};

export type Instalment = {
  number: number;
  dueDate: string;
  payment: Money;
  principal: Money;
  interest: Money;
  /** Outstanding after this instalment. */
  balance: Money;
};

const PAISA = 2;
const round2 = (v: Money): Money => v.toDecimalPlaces(PAISA, MoneyDecimal.ROUND_HALF_UP);

export function monthlyRate(annualRatePct: Money): Money {
  return annualRatePct.dividedBy(1200);
}

export function monthlyPayment(principal: Money, annualRatePct: Money, termMonths: number): Money {
  if (!Number.isInteger(termMonths) || termMonths < 1) throw new Error('termMonths must be ≥ 1');
  const r = monthlyRate(annualRatePct);
  if (r.isZero()) return round2(principal.dividedBy(termMonths));
  const growth = r.plus(1).pow(termMonths);
  return round2(principal.times(r).times(growth).dividedBy(growth.minus(1)));
}

/** `isoDate` plus `months`, keeping the day of month but clamping to month end (31 Jan → 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(d < lastDay ? d : lastDay);
  return target.toISOString().slice(0, 10);
}

export function amortizationSchedule(terms: LoanTerms): Instalment[] {
  const r = monthlyRate(terms.annualRatePct);
  const emi = monthlyPayment(terms.principal, terms.annualRatePct, terms.termMonths);
  const rows: Instalment[] = [];
  let balance = terms.principal;
  for (let n = 1; n <= terms.termMonths && balance.greaterThan(0); n++) {
    const interest = round2(balance.times(r));
    let principal = emi.minus(interest);
    if (n === terms.termMonths || principal.greaterThan(balance)) principal = balance;
    if (principal.isNegative()) principal = ZERO;
    balance = balance.minus(principal);
    rows.push({
      number: n,
      dueDate: addMonths(terms.firstPaymentDate, n - 1),
      payment: principal.plus(interest),
      principal,
      interest,
      balance,
    });
  }
  return rows;
}

/**
 * Suggested split of the next payment from the ACTUAL outstanding amount:
 * one month's interest on what is owed now, the rest of the usual instalment
 * as principal (never more than is outstanding). The user can change both.
 */
export function suggestNextPayment(args: {
  outstanding: Money;
  annualRatePct: Money | null;
  instalment: Money | null;
}): { principal: Money; interest: Money } | null {
  if (!args.outstanding.greaterThan(0)) return null;
  const interest = args.annualRatePct
    ? round2(args.outstanding.times(monthlyRate(args.annualRatePct)))
    : ZERO;
  if (!args.instalment) return { principal: ZERO, interest };
  let principal = args.instalment.minus(interest);
  if (principal.isNegative()) principal = ZERO;
  if (principal.greaterThan(args.outstanding)) principal = args.outstanding;
  return { principal, interest };
}

/**
 * Next scheduled due date: the first instalment after the latest payment, or
 * (with no payments yet) the first one on/after the loan was recorded.
 */
export function nextDueDate(args: {
  schedule: readonly Instalment[];
  lastPaidOn: string | null;
  openedOn: string;
}): string | null {
  const next = args.schedule.find((row) =>
    args.lastPaidOn ? row.dueDate > args.lastPaidOn : row.dueDate >= args.openedOn,
  );
  return next?.dueDate ?? null;
}
