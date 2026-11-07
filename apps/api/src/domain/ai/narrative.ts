import type { NarrativeSegment } from '@takawise/contracts';
import { ANY_DIGIT, cleanText, looksLikeInjection } from './redact';

/**
 * Validation of model-written insight prose (Phase 9, ADR-024).
 *
 * The model must reference facts as {{fact_id}} and may not write any digit
 * itself, so every number shown to the user comes from the backend and is
 * formatted by the client in the user's locale. Anything that breaks the rules
 * is dropped; an invalid headline rejects the whole answer.
 */

export const MAX_POINTS = 5;
export const MAX_HEADLINE_CHARS = 240;
export const MAX_POINT_CHARS = 400;

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g;

export class NarrativeInvalidError extends Error {
  constructor(public readonly reason: string) {
    super(`Model narrative rejected: ${reason}`);
    this.name = 'NarrativeInvalidError';
  }
}

/** Returns segments, or a reason string when the text breaks a rule. */
export function parseNarrative(
  raw: string,
  factIds: ReadonlySet<string>,
  maxChars: number,
): NarrativeSegment[] | string {
  const text = cleanText(raw, maxChars + 200);
  if (text.length === 0) return 'empty';
  if (looksLikeInjection(text)) return 'instruction-like text';
  if (/https?:|www\.|\]\(/i.test(text)) return 'link';
  if (/[<>{}]/.test(text.replace(PLACEHOLDER, ''))) return 'markup';

  const segments: NarrativeSegment[] = [];
  let last = 0;
  let visible = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const id = match[1]!;
    if (!factIds.has(id)) return `unknown fact ${id}`;
    const before = text.slice(last, match.index);
    if (before) segments.push({ type: 'text', text: before });
    segments.push({ type: 'fact', factId: id });
    visible += before.length;
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail) segments.push({ type: 'text', text: tail });
  visible += tail.length;

  for (const s of segments) {
    if (s.type === 'text' && ANY_DIGIT.test(s.text)) return 'digits outside placeholders';
  }
  if (visible > maxChars) return 'too long';
  return segments;
}

export function validateInsightNarrative(
  output: { headline: string; points: string[] },
  factIds: ReadonlySet<string>,
): { headline: NarrativeSegment[]; points: NarrativeSegment[][]; dropped: number } {
  const headline = parseNarrative(output.headline, factIds, MAX_HEADLINE_CHARS);
  if (typeof headline === 'string') throw new NarrativeInvalidError(`headline: ${headline}`);
  const points: NarrativeSegment[][] = [];
  let dropped = 0;
  for (const raw of output.points.slice(0, MAX_POINTS)) {
    const parsed = parseNarrative(raw, factIds, MAX_POINT_CHARS);
    if (typeof parsed === 'string') dropped += 1;
    else points.push(parsed);
  }
  if (output.points.length > MAX_POINTS) dropped += output.points.length - MAX_POINTS;
  if (points.length === 0 && output.points.length > 0) {
    throw new NarrativeInvalidError('every point broke the rules');
  }
  return { headline, points, dropped };
}
