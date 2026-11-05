import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CSRF_COOKIE, CSRF_HEADER } from '@takawise/contracts';
import type { Request } from 'express';
import { AppException } from '../../../common/errors/app.exception';
import { APP_CONFIG } from '../../../config/config.module';
import type { AppConfig } from '../../../config/env';
import { safeEqual } from '../crypto/secure-tokens';

/**
 * Protects the cookie-authenticated endpoints (/auth/refresh, /auth/logout):
 *  1. if an Origin header is present it must be in the CORS allowlist, and
 *  2. the X-CSRF-Token header must equal the tw_csrf cookie (double submit).
 * A cross-site attacker can make the browser send cookies but cannot read the
 * CSRF cookie to copy it into a header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const origin = req.headers.origin;
    if (origin && !this.config.CORS_ORIGINS.includes(origin)) throw csrfFailed();

    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const cookie = cookies?.[CSRF_COOKIE];
    const header = req.get(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header)) throw csrfFailed();
    return true;
  }
}

function csrfFailed(): AppException {
  return new AppException(
    'CSRF_FAILED',
    'The request could not be verified. Please refresh and try again.',
    HttpStatus.FORBIDDEN,
  );
}
