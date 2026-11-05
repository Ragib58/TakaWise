import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'takawise:is-public';

/**
 * Opt a route out of authentication. Everything else is protected by default
 * (ADR-013 "default deny").
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Identity resolved by JwtAuthGuard from a verified access token + live session. */
export type AuthContext = {
  userId: string;
  sessionId: string;
};

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/**
 * The only source of the acting user's id. Never read a user id from the body,
 * query or path for authorization (blueprint §3).
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error('CurrentUser used on a route without authentication');
  return auth;
});
