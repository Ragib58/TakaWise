import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { getRequestId } from '../request-id';

/** Request metadata used for sessions and audit logs. Raw IPs are never stored. */
export type ClientContext = {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
};

export function clientContextFrom(req: Request): ClientContext {
  const userAgent = req.get('user-agent');
  return {
    requestId: getRequestId(req),
    // Honours `trust proxy` (TRUST_PROXY) so X-Forwarded-For is only used behind a known proxy.
    ip: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}

export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientContext =>
  clientContextFrom(ctx.switchToHttp().getRequest<Request>()),
);
