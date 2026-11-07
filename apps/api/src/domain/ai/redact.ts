/**
 * Data minimisation and untrusted-text hygiene for anything that is sent to,
 * or comes back from, an AI provider (Phase 9, ADR-024). Pure functions.
 */

const BANGLA_ZERO = 0x09e6;

/** Bangla digits (০-৯) → ASCII so amounts typed in Bangla parse the same way. */
export function toAsciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - BANGLA_ZERO));
}

/** Any digit a reader would see as a number, ASCII or Bangla. */
export const ANY_DIGIT = /[0-9০-৯]/;

// C0 controls except \t \n \r, DEL, zero-width and bidi override characters
// (the last two can hide text from a human reviewer).
const INVISIBLE =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** Strip invisible characters, collapse whitespace and cap the length. */
export function cleanText(text: string, maxLength: number): string {
  const cleaned = text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trimEnd() : cleaned;
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
// A run of digits, optionally separated by spaces/dashes/dots, possibly with a leading +.
const DIGIT_RUN = /\+?[0-9০-৯](?:[0-9০-৯ \-.]*[0-9০-৯])?/g;
/** Phone (11+ digits in BD), card and bank account numbers; amounts stay visible. */
const IDENTIFIER_MIN_DIGITS = 10;

/**
 * Removes identifiers before text leaves the system: e-mail addresses, links and
 * long digit runs (phone, card, account, NID numbers). Amounts below ten digits
 * are kept because they are the point of a transaction draft.
 */
export function redactIdentifiers(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(URL, '[link]')
    .replace(DIGIT_RUN, (run) =>
      (run.match(/[0-9০-৯]/g) ?? []).length >= IDENTIFIER_MIN_DIGITS ? '[number]' : run,
    );
}

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instruction|prompt|rule|above|previous|prior)/i,
  /\bsystem\s*prompt\b/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /^\s*(?:system|assistant|developer)\s*:/im,
  /<\/?\s*(?:system|instructions?|untrusted_input|assistant)\b/i,
  /\b(?:reveal|print|repeat)\b[^.]{0,30}\b(?:prompt|instructions)\b/i,
];

/**
 * Heuristic flag for text that tries to instruct the model (prompt injection in
 * a receipt or a pasted sentence). Never the only defence — output is also
 * schema-constrained and validated — but lets us blank the field and warn.
 */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Wrap untrusted text so the prompt can tell the model it is data. */
export function asUntrustedBlock(text: string): string {
  // The closing tag cannot be forged from inside the block.
  const safe = text.replace(/<\/?\s*untrusted_input\s*>/gi, '');
  return `<untrusted_input>\n${safe}\n</untrusted_input>`;
}
