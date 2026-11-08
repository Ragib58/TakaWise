import { healthResponseSchema } from '@takawise/contracts';
import { describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, ApiError, apiRequest } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const health = {
  status: 'ok',
  service: 'takawise-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 1,
  timestamp: '2026-11-05T00:00:00.000Z',
};

describe('apiRequest', () => {
  it('unwraps the success envelope and validates with a schema', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: health, meta: { requestId: 'r1' } }));

    const result = await apiRequest('/health', { schema: healthResponseSchema, fetchImpl });

    expect(result.data.status).toBe('ok');
    expect(result.meta.requestId).toBe('r1');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API_BASE_URL}/health`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('treats 204 No Content as success without an envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiRequest('/family/workspaces/x', { method: 'DELETE', fetchImpl });
    expect(result.data).toBeUndefined();
  });

  it('serialises JSON bodies with the right content type', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: {}, meta: { requestId: 'r' } }));

    await apiRequest('/echo', { method: 'POST', body: { amount: '450.00' }, fetchImpl });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"amount":"450.00"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('converts the error envelope into ApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the submitted fields.',
          details: [{ field: 'amount', message: 'Must be > 0' }],
          requestId: 'r2',
        },
      }),
    );

    const error = await apiRequest('/x', { fetchImpl }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      requestId: 'r2',
      details: [{ field: 'amount', message: 'Must be > 0' }],
    });
  });

  it('reports network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(apiRequest('/x', { fetchImpl })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('rejects payloads that do not match the schema', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: { status: 'nope' }, meta: { requestId: 'r3' } }),
      );
    await expect(
      apiRequest('/health', { schema: healthResponseSchema, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      requestId: 'r3',
    });
  });

  it('rejects non-envelope success bodies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    await expect(apiRequest('/x', { fetchImpl })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
