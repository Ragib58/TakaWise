'use client';

import type { InsightFact, NarrativeSegment } from '@takawise/contracts';
import { ApiError } from '@/lib/api-client';
import { formatMoney, formatNumber, type UiLocale } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n/messages';

/** A backend-computed fact, formatted for the user's locale. */
export function formatFact(fact: InsightFact, currency: string, locale: UiLocale): string {
  switch (fact.type) {
    case 'money':
      return formatMoney(fact.value, currency, locale);
    case 'percent':
      return `${formatNumber(fact.value, locale, 1)}%`;
    case 'count':
      return formatNumber(fact.value, locale, 0);
    case 'text':
      return fact.value;
  }
}

/**
 * Renders model prose with every number substituted from the facts. The model
 * never supplies a number itself (ADR-024); a missing fact renders nothing.
 */
export function Narrative({
  segments,
  facts,
  currency,
  locale,
}: {
  segments: NarrativeSegment[];
  facts: InsightFact[];
  currency: string;
  locale: UiLocale;
}) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === 'text') return <span key={i}>{s.text}</span>;
        const fact = facts.find((f) => f.id === s.factId);
        return fact ? (
          <strong
            key={i}
            className="font-semibold tabular-nums"
            title={locale === 'bn' ? fact.labelBn : fact.labelEn}
          >
            {formatFact(fact, currency, locale)}
          </strong>
        ) : null;
      })}
    </>
  );
}

const AI_ERROR_CODES = [
  'AI_LIMIT_REACHED',
  'AI_UNAVAILABLE',
  'AI_OUTPUT_INVALID',
  'AI_CONSENT_REQUIRED',
  'FEATURE_DISABLED',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
] as const;

/** Localised message for AI errors; other errors keep the server's message. */
export function aiErrorText(error: unknown, t: (key: MessageKey) => string): string {
  if (error instanceof ApiError) {
    const code = AI_ERROR_CODES.find((c) => c === error.code);
    if (code) return t(`ai.error.${code}`);
    return error.details[0]?.message ?? error.message;
  }
  return t('common.saveError');
}
