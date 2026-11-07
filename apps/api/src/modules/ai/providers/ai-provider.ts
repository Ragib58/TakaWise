import type { AiFeature } from '@takawise/contracts';
import type { z } from 'zod';

/**
 * Provider adapter boundary (Phase 9, ADR-024). Feature code builds a minimised
 * request and receives schema-validated output; it never sees an SDK type, so a
 * provider can be swapped (or faked) without touching the features.
 */

export type ReceiptMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export type AiContentPart =
  { type: 'text'; text: string } | { type: 'image'; mediaType: ReceiptMediaType; data: Buffer };

/** Mapped to the provider's reasoning-effort control; these tasks are small. */
export type AiEffort = 'low' | 'medium';

export type AiGenerateRequest<T> = {
  feature: AiFeature;
  system: string;
  content: AiContentPart[];
  /** Output contract. Kept simple (strings, enums, arrays) so every provider can honour it. */
  schema: z.ZodType<T>;
  effort: AiEffort;
  maxOutputTokens: number;
};

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiGenerateResult<T> = { output: T; model: string; usage: AiUsage };

export type AiProviderErrorCode =
  /** The model declined (policy). */
  | 'REFUSED'
  /** Output missing, truncated or not matching the schema. */
  | 'INVALID_OUTPUT'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  /** Bad key, permissions or request shape: an operator problem, not the user's. */
  | 'CONFIG';

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly usage: AiUsage = { inputTokens: 0, outputTokens: 0 },
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Injection token and contract for the configured provider. */
export abstract class AiProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  abstract generate<T>(request: AiGenerateRequest<T>): Promise<AiGenerateResult<T>>;
}
