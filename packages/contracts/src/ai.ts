import { z } from 'zod';
import { localeSchema } from './auth';
import { currencyCodeSchema, isoDateSchema } from './money';
import { monthSchema } from './planning';

/**
 * Opt-in AI and OCR (Phase 9, ADR-024). The backend computes every number; the
 * model only writes prose around numbered facts it is given, and drafts are never
 * saved without the user reviewing them.
 */

/** Bump when what is shared with the provider changes; users must re-consent. */
export const AI_POLICY_VERSION = '2026-11-07';

export const AI_CONSENT_SCOPES = ['INSIGHTS', 'TRANSACTION_DRAFT', 'RECEIPT_OCR'] as const;
export const aiConsentScopeSchema = z.enum(AI_CONSENT_SCOPES);
export type AiConsentScope = z.infer<typeof aiConsentScopeSchema>;

export const INSIGHT_KINDS = [
  'MONTHLY_SUMMARY',
  'UNUSUAL_SPENDING',
  'SAVINGS_SUGGESTIONS',
] as const;
export const insightKindSchema = z.enum(INSIGHT_KINDS);
export type InsightKind = z.infer<typeof insightKindSchema>;

export const AI_FEATURES = [...INSIGHT_KINDS, 'TRANSACTION_DRAFT', 'RECEIPT_OCR'] as const;
export const aiFeatureSchema = z.enum(AI_FEATURES);
export type AiFeature = z.infer<typeof aiFeatureSchema>;

/** Which consent each feature needs. */
export const CONSENT_FOR_FEATURE: Record<AiFeature, AiConsentScope> = {
  MONTHLY_SUMMARY: 'INSIGHTS',
  UNUSUAL_SPENDING: 'INSIGHTS',
  SAVINGS_SUGGESTIONS: 'INSIGHTS',
  TRANSACTION_DRAFT: 'TRANSACTION_DRAFT',
  RECEIPT_OCR: 'RECEIPT_OCR',
};

/**
 * Optional parts of the insight data scope the user can switch off per request.
 * Totals by month are always included (they are the point of an insight).
 */
export const AI_DATA_SCOPES = ['CATEGORY_NAMES', 'BUDGETS', 'GOALS'] as const;
export const aiDataScopeSchema = z.enum(AI_DATA_SCOPES);
export type AiDataScope = z.infer<typeof aiDataScopeSchema>;

export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// ──────────────────────────────── Status & consent ────────────────────────────────

export const aiConsentStatusSchema = z.object({
  scope: aiConsentScopeSchema,
  granted: z.boolean(),
  grantedAt: z.iso.datetime().nullable(),
  /** Notice version accepted; a consent for an older version is not valid. */
  policyVersion: z.string().nullable(),
});
export type AiConsentStatus = z.infer<typeof aiConsentStatusSchema>;

export const aiStatusResponseSchema = z.object({
  /** AI switched on by the operator and a provider configured. */
  enabled: z.boolean(),
  /** `anthropic` or `fake` (development only); null when disabled. */
  provider: z.string().nullable(),
  model: z.string().nullable(),
  policyVersion: z.string(),
  /** Enabled feature flags. */
  features: z.array(aiFeatureSchema),
  consents: z.array(aiConsentStatusSchema),
  usage: z.object({
    requestsToday: z.number().int(),
    dailyRequestLimit: z.number().int(),
    tokensThisMonth: z.number().int(),
    monthlyTokenLimit: z.number().int(),
  }),
  receiptMaxBytes: z.number().int(),
});
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;

export const grantAiConsentRequestSchema = z.strictObject({
  /** Must equal AI_POLICY_VERSION: proves the client showed the current notice. */
  policyVersion: z.literal(AI_POLICY_VERSION, {
    message: 'The AI data notice has changed; please review it again',
  }),
});
export type GrantAiConsentRequest = z.input<typeof grantAiConsentRequestSchema>;

export const deleteAiDataResponseSchema = z.object({
  consentsRevoked: z.number().int(),
  insightsDeleted: z.number().int(),
});
export type DeleteAiDataResponse = z.infer<typeof deleteAiDataResponseSchema>;

// ──────────────────────────────── Insights ────────────────────────────────

export const insightRequestSchema = z.strictObject({
  kind: insightKindSchema,
  month: monthSchema,
  currency: currencyCodeSchema.optional(),
  locale: localeSchema.optional(),
  /** Optional data the user is willing to share for this insight. */
  include: z
    .array(aiDataScopeSchema)
    .max(AI_DATA_SCOPES.length)
    .default([...AI_DATA_SCOPES]),
  /** Ignore the cached insight and ask the provider again (counts against limits). */
  refresh: z.boolean().default(false),
});
export type InsightRequest = z.input<typeof insightRequestSchema>;

export const FACT_TYPES = ['money', 'percent', 'count', 'text'] as const;

/** A backend-computed number (or label) the narrative may reference by id. */
export const insightFactSchema = z.object({
  id: z.string(),
  type: z.enum(FACT_TYPES),
  /** money: decimal string in `currency`; percent: "12.50"; count: integer; text: label. */
  value: z.string(),
  labelEn: z.string(),
  labelBn: z.string(),
});
export type InsightFact = z.infer<typeof insightFactSchema>;

/** Narrative is text interleaved with fact references; the client formats the values. */
export const narrativeSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('fact'), factId: z.string() }),
]);
export type NarrativeSegment = z.infer<typeof narrativeSegmentSchema>;

export const INSIGHT_LIMITATIONS = [
  /** The month has not ended; figures will change. */
  'MONTH_IN_PROGRESS',
  /** Only one currency is analysed; other currencies are ignored. */
  'SINGLE_CURRENCY',
  /** Built from what the user recorded; unrecorded spending is invisible. */
  'RECORDED_DATA_ONLY',
  /** Fewer than three earlier months to compare with. */
  'SHORT_HISTORY',
  /** Category names were withheld, so explanations are generic. */
  'CATEGORY_NAMES_WITHHELD',
] as const;
export const insightLimitationSchema = z.enum(INSIGHT_LIMITATIONS);
export type InsightLimitation = z.infer<typeof insightLimitationSchema>;

export const insightResponseSchema = z.object({
  kind: insightKindSchema,
  month: monthSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  currency: z.string(),
  locale: localeSchema,
  /**
   * NO_DATA: no posted transactions in the month. NOTHING_UNUSUAL: no category
   * stood out. In both cases the provider was not called.
   */
  status: z.enum(['READY', 'NO_DATA', 'NOTHING_UNUSUAL']),
  /** Served from the stored insight because the facts have not changed. */
  cached: z.boolean(),
  generatedAt: z.iso.datetime().nullable(),
  model: z.string().nullable(),
  /** Exactly what was shared with the provider for this insight. */
  dataScope: z.array(aiDataScopeSchema),
  facts: z.array(insightFactSchema),
  headline: z.array(narrativeSegmentSchema),
  points: z.array(z.array(narrativeSegmentSchema)),
  limitations: z.array(insightLimitationSchema),
});
export type InsightResponse = z.infer<typeof insightResponseSchema>;

// ──────────────────────────────── Drafts (NL + OCR) ────────────────────────────────

export const transactionDraftRequestSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(3, 'Describe the transaction in a few words')
    .max(300, 'Keep it under 300 characters'),
  locale: localeSchema.optional(),
});
export type TransactionDraftRequest = z.input<typeof transactionDraftRequestSchema>;

export const DRAFT_FIELDS = ['type', 'amount', 'account', 'category', 'date'] as const;
export const DRAFT_WARNINGS = [
  /** Text looked like instructions to the AI; it was ignored. */
  'SUSPICIOUS_CONTENT',
  /** More than one transaction described; only the first was drafted. */
  'MULTIPLE_TRANSACTIONS',
  /** The date was in the future or too far back; please pick one. */
  'DATE_OUT_OF_RANGE',
  /** Detected currency differs from the suggested account's currency. */
  'CURRENCY_MISMATCH',
  /** The model was unsure; check every field. */
  'LOW_CONFIDENCE',
] as const;

export const transactionDraftSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']).nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  occurredOn: isoDateSchema.nullable(),
  accountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  description: z.string().nullable(),
  missing: z.array(z.enum(DRAFT_FIELDS)),
  warnings: z.array(z.enum(DRAFT_WARNINGS)),
});
export type TransactionDraft = z.infer<typeof transactionDraftSchema>;

export const receiptLineItemSchema = z.object({
  description: z.string(),
  amount: z.string().nullable(),
});

export const draftResponseSchema = z.object({
  source: z.enum(['TEXT', 'RECEIPT']),
  /** Always true: nothing has been saved; the user must confirm. */
  requiresReview: z.literal(true),
  draft: transactionDraftSchema,
  /** Receipt only. */
  merchant: z.string().nullable(),
  lineItems: z.array(receiptLineItemSchema),
  model: z.string(),
});
export type DraftResponse = z.infer<typeof draftResponseSchema>;
