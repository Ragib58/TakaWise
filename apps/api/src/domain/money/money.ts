import Decimal from 'decimal.js';
import { MONEY_PATTERN, MONEY_SCALE } from '@takawise/contracts';

/**
 * Decimal arithmetic for money (ADR-003). A dedicated clone so global
 * decimal.js settings elsewhere can never change financial results.
 * Precision 40 comfortably covers NUMERIC(20,4) sums.
 */
export const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Money = InstanceType<typeof MoneyDecimal>;

export class InvalidMoneyError extends Error {
  constructor(input: unknown, reason: string) {
    super(`Invalid money amount ${JSON.stringify(input)}: ${reason}`);
    this.name = 'InvalidMoneyError';
  }
}

/** Anything a Prisma Decimal / decimal.js value or string can be converted from. */
export type MoneyInput = string | { toString(): string };

/**
 * Parse a money string as received from the API. Accepts zero; use
 * {@link parsePositiveMoney} where a strictly positive amount is required.
 * JS numbers are rejected on purpose: they may already have lost precision.
 */
export function parseMoney(input: string): Money {
  if (typeof input !== 'string') throw new InvalidMoneyError(input, 'must be a string');
  const value = input.trim();
  if (!MONEY_PATTERN.test(value)) {
    throw new InvalidMoneyError(input, `expected up to 16 digits and ${MONEY_SCALE} decimals`);
  }
  return new MoneyDecimal(value);
}

export function parsePositiveMoney(input: string): Money {
  const value = parseMoney(input);
  if (value.isZero()) throw new InvalidMoneyError(input, 'must be greater than 0');
  return value;
}

/** Wrap a value read from the database (Prisma Decimal) without re-validation. */
export function money(value: MoneyInput): Money {
  return new MoneyDecimal(value.toString());
}

export const ZERO: Money = new MoneyDecimal(0);

export function sumMoney(values: Iterable<MoneyInput>): Money {
  let total = ZERO;
  for (const v of values) total = total.plus(money(v));
  return total;
}

/** Canonical storage/API representation with the full 4-dp scale, e.g. "450.0000". */
export function toMoneyString(value: Money): string {
  return value.toFixed(MONEY_SCALE);
}
