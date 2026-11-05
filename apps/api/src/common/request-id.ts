import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER } from '@takawise/contracts';

/** Accept caller-supplied IDs only if they are short and safe to echo/log. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Used by pino-http as `genReqId`: reuse a well-formed incoming X-Request-Id,
 * otherwise mint a UUID, and always echo it back on the response.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** Read the request ID assigned by pino-http (`req.id`). */
export function getRequestId(req: unknown): string {
  const id = (req as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : 'unknown';
}
