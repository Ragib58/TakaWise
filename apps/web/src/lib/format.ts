export type UiLocale = 'en' | 'bn';

const intlLocale = (locale: UiLocale) => (locale === 'bn' ? 'bn-BD' : 'en-BD');

/**
 * Display-only formatting of an API money STRING (never parsed into a JS number:
 * Intl formats decimal strings exactly). Bangla uses Bangla digits and lakh
 * grouping automatically.
 */
export function formatMoney(amount: string, currency: string, locale: UiLocale = 'en'): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount as Intl.StringNumericLiteral);
}

/** "2026-11" → "November 2026" (or Bangla). */
export function formatMonth(month: string, locale: UiLocale = 'en'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** ISO date (YYYY-MM-DD) → localized calendar date, no time-zone shift. */
export function formatDate(isoDate: string, locale: UiLocale = 'en'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Instant → date and time in the given IANA time zone. */
export function formatDateTime(iso: string, timeZone: string, locale: UiLocale = 'en'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** "2026-11" for the current month in a time zone. */
export function currentMonth(timeZone = 'Asia/Dhaka', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone })
    .format(now)
    .slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map((part) => Number.parseInt(part, 10)) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
