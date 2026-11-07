import { MONEY_PATTERN, type TransactionDraft } from '@takawise/contracts';
import { MoneyDecimal } from '../money/money';
import { cleanText, looksLikeInjection, redactIdentifiers, toAsciiDigits } from './redact';

/**
 * Turns a model's raw transaction draft (from a sentence or a receipt) into a
 * safe, reviewable draft (Phase 9, ADR-024). Nothing here saves anything: the
 * user confirms every field in the normal transaction form.
 *
 * The model only ever sees short aliases (A1, C3); ids are mapped back here and
 * only to the caller's own accounts and categories.
 */

export type RawDraft = {
  type: 'INCOME' | 'EXPENSE' | 'UNKNOWN';
  amount: string;
  currency: string;
  date: string;
  accountRef: string;
  categoryRef: string;
  description: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  multipleTransactions: boolean;
  instructionsDetected: boolean;
};

export type RawReceipt = RawDraft & {
  merchant: string;
  lineItems: Array<{ description: string; amount: string }>;
};

export type DraftContext = {
  accounts: ReadonlyArray<{ ref: string; id: string; currency: string }>;
  categories: ReadonlyArray<{ ref: string; id: string; type: 'INCOME' | 'EXPENSE' }>;
  /** Today in the user's time zone (YYYY-MM-DD). */
  today: string;
  defaultCurrency: string;
};

export const MAX_DRAFT_AGE_DAYS = 366;
export const MAX_LINE_ITEMS = 20;

/** "১,২৫০.৫০ টাকা" → "1250.50"; null when it is not a positive money amount. */
export function normalizeAmount(raw: string): string | null {
  const ascii = toAsciiDigits(raw)
    .replace(/[,\s_]/g, '')
    .replace(/^(?:BDT|Tk\.?|৳)/i, '');
  if (!MONEY_PATTERN.test(ascii)) {
    // Up to 2 extra decimals from OCR ("12.505") are rounded rather than rejected.
    if (!/^\d{1,16}\.\d{5,6}$/.test(ascii)) return null;
  }
  const value = new MoneyDecimal(ascii).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
  return value.greaterThan(0) ? value.toFixed(2) : null;
}

const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const daysBefore = (later: string, earlier: string) =>
  (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000;

/** User-visible free text from the model: cleaned, identifiers redacted, injection blanked. */
export function safeText(raw: string, max: number): { text: string | null; suspicious: boolean } {
  const text = cleanText(redactIdentifiers(raw), max);
  if (!text) return { text: null, suspicious: false };
  if (looksLikeInjection(text)) return { text: null, suspicious: true };
  return { text, suspicious: false };
}

export function validateDraft(raw: RawDraft, ctx: DraftContext): TransactionDraft {
  const warnings = new Set<TransactionDraft['warnings'][number]>();
  const missing: TransactionDraft['missing'] = [];

  const type = raw.type === 'UNKNOWN' ? null : raw.type;
  if (!type) missing.push('type');

  const amount = raw.amount.trim() ? normalizeAmount(raw.amount) : null;
  if (!amount) missing.push('amount');

  // Only the caller's own accounts; a single account is the obvious choice.
  const account =
    ctx.accounts.find((a) => a.ref === raw.accountRef.trim().toUpperCase()) ??
    (ctx.accounts.length === 1 ? ctx.accounts[0] : undefined);
  if (!account) missing.push('account');

  const category = ctx.categories.find(
    (c) => c.ref === raw.categoryRef.trim().toUpperCase() && c.type === type,
  );
  if (!category) missing.push('category');

  let occurredOn: string | null = ctx.today;
  const date = raw.date.trim();
  if (date) {
    const age = isIsoDate(date) ? daysBefore(ctx.today, date) : Number.NaN;
    if (!(age >= 0 && age <= MAX_DRAFT_AGE_DAYS)) {
      occurredOn = null;
      warnings.add('DATE_OUT_OF_RANGE');
      missing.push('date');
    } else {
      occurredOn = date;
    }
  }

  const detected = /^[A-Z]{3}$/.test(raw.currency.trim()) ? raw.currency.trim() : null;
  const currency = account?.currency ?? detected ?? ctx.defaultCurrency;
  if (detected && detected !== currency) warnings.add('CURRENCY_MISMATCH');

  const description = safeText(raw.description, 120);
  if (description.suspicious || raw.instructionsDetected) warnings.add('SUSPICIOUS_CONTENT');
  if (raw.multipleTransactions) warnings.add('MULTIPLE_TRANSACTIONS');
  if (raw.confidence === 'LOW') warnings.add('LOW_CONFIDENCE');

  return {
    type,
    amount,
    currency,
    occurredOn,
    accountId: account?.id ?? null,
    categoryId: category?.id ?? null,
    description: description.text,
    missing,
    warnings: [...warnings],
  };
}

export function validateReceipt(
  raw: RawReceipt,
  ctx: DraftContext,
): {
  draft: TransactionDraft;
  merchant: string | null;
  lineItems: Array<{ description: string; amount: string | null }>;
} {
  // A receipt is always money going out.
  const draft = validateDraft({ ...raw, type: 'EXPENSE' }, ctx);
  const merchant = safeText(raw.merchant, 80);
  let suspicious = merchant.suspicious;
  const lineItems: Array<{ description: string; amount: string | null }> = [];
  for (const item of raw.lineItems.slice(0, MAX_LINE_ITEMS)) {
    const text = safeText(item.description, 60);
    suspicious ||= text.suspicious;
    if (!text.text) continue;
    lineItems.push({ description: text.text, amount: normalizeAmount(item.amount) });
  }
  if (suspicious && !draft.warnings.includes('SUSPICIOUS_CONTENT')) {
    draft.warnings.push('SUSPICIOUS_CONTENT');
  }
  if (!draft.description && merchant.text) draft.description = merchant.text;
  return { draft, merchant: merchant.text, lineItems };
}
