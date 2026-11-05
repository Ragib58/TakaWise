import { z } from 'zod';

/**
 * Money on the wire (ADR-003): a positive decimal STRING with up to 16 integer
 * digits and up to 4 fraction digits, e.g. "450.00". Never a JSON number.
 * Matches NUMERIC(20,4) in the database.
 */
export const MONEY_MAX_INTEGER_DIGITS = 16;
export const MONEY_SCALE = 4;

export const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/;

/** Non-negative money string (allows "0", e.g. an opening balance). */
export const moneyAmountOrZeroSchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, 'Must be a decimal amount with at most 4 decimal places');

/** Strictly positive money string (transactions, transfers, budgets, goals). */
export const moneyAmountSchema = moneyAmountOrZeroSchema.refine(
  (value) => !/^0(?:\.0+)?$/.test(value),
  'Must be greater than 0',
);

/** ISO-4217 alphabetic code. MVP defaults to BDT (ADR-016). */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO-4217 currency code');

export const DEFAULT_CURRENCY = 'BDT';
export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

/** Calendar date without time, used for financial effective dates (ADR-012). */
export const isoDateSchema = z.iso.date();
