/**
 * CSV encoding for exports (EXP-01, blueprint §10 security tests).
 *
 * Spreadsheet formula injection: a cell starting with = + - @ (or tab / CR)
 * may be executed by Excel/Sheets. Such cells are prefixed with an apostrophe
 * so they are shown as text (OWASP "CSV Injection" guidance). Every field is
 * quoted, with embedded quotes doubled (RFC 4180).
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  const safe = FORMULA_TRIGGER.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(values: ReadonlyArray<string | null | undefined>): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/** UTF-8 byte-order mark so Excel opens Bangla text correctly. */
export const CSV_BOM = '﻿';
