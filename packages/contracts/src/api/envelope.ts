import { z } from 'zod';

/**
 * Standard API envelopes (blueprint §8 "Response conventions").
 *
 *   Success:   { data, meta: { requestId } }
 *   Paginated: { data: [], meta: { page, pageSize, total, totalPages, requestId } }
 *   Error:     { error: { code, message, details[], requestId } }
 */

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_MISMATCH',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
});
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.array(apiErrorDetailSchema),
    requestId: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export const apiMetaSchema = z.object({
  requestId: z.string(),
});
export type ApiMeta = z.infer<typeof apiMetaSchema>;

export const paginationMetaSchema = apiMetaSchema.extend({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: apiMetaSchema });
}

export function paginatedEnvelopeSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: paginationMetaSchema });
}

export type SuccessEnvelope<T> = { data: T; meta: ApiMeta };
export type PaginatedEnvelope<T> = { data: T[]; meta: PaginationMeta };

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Query-string pagination input. Values arrive as strings and are coerced. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function buildPaginationMeta(
  args: { page: number; pageSize: number; total: number },
  requestId: string,
): PaginationMeta {
  return {
    page: args.page,
    pageSize: args.pageSize,
    total: args.total,
    totalPages: args.total === 0 ? 0 : Math.ceil(args.total / args.pageSize),
    requestId,
  };
}
