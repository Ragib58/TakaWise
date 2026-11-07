import {
  apiErrorEnvelopeSchema,
  type ApiErrorCode,
  type ApiErrorDetail,
  type ApiMeta,
} from '@takawise/contracts';
import type { z } from 'zod';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1'
).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
    message: string,
    public readonly details: ApiErrorDetail[] = [],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiRequestOptions<T> = Omit<RequestInit, 'body'> & {
  /** JSON-serialisable body. */
  body?: unknown;
  /** Optional runtime schema for `data`; strongly recommended for financial payloads. */
  schema?: z.ZodType<T>;
  fetchImpl?: typeof fetch;
};

export type ApiResult<T> = { data: T; meta: ApiMeta };

/**
 * Typed fetch wrapper for the TakaWise API. Unwraps the standard envelope and
 * converts error envelopes into `ApiError`. Never performs money arithmetic.
 */
export async function apiRequest<T>(
  path: string,
  { body, schema, fetchImpl = fetch, headers, ...init }: ApiRequestOptions<T> = {},
): Promise<ApiResult<T>> {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  // Multipart uploads: the browser sets Content-Type with the boundary itself.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) finalHeaders.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetchImpl(url, {
      credentials: 'include',
      ...init,
      headers: finalHeaders,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorEnvelopeSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      throw new ApiError(response.status, code, message, details, requestId);
    }
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Unexpected server response.');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('data' in payload) ||
    !('meta' in payload)
  ) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Unexpected server response.');
  }

  const envelope = payload as { data: unknown; meta: ApiMeta };
  if (schema) {
    const result = schema.safeParse(envelope.data);
    if (!result.success) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        'Unexpected server response.',
        [],
        envelope.meta.requestId,
      );
    }
    return { data: result.data, meta: envelope.meta };
  }
  return { data: envelope.data as T, meta: envelope.meta };
}
