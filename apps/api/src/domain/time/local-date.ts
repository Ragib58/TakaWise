/**
 * Financial effective dates (ADR-012): the calendar date on which an instant
 * falls in the user's time zone. Asia/Dhaka is UTC+6 with no DST, so e.g.
 * 2026-11-05T19:30Z is already 6 November locally.
 */
export function localDateOf(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** A DATE column value (Prisma maps @db.Date to a UTC-midnight Date). */
export function dateOnly(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Invalid ISO date: ${isoDate}`);
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/**
 * An instant that falls on `isoDate` in `timeZone` (around midday), for
 * postings the user describes by date only — e.g. a loan disbursed on its
 * opening date.
 */
export function instantOnLocalDate(isoDate: string, timeZone: string): Date {
  for (const time of ['12:00', '06:00', '18:00', '00:00', '23:59']) {
    const candidate = new Date(`${isoDate}T${time}:00.000Z`);
    if (localDateOf(candidate, timeZone) === isoDate) return candidate;
  }
  return new Date(`${isoDate}T12:00:00.000Z`);
}

/** Inverse of {@link dateOnly}. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
