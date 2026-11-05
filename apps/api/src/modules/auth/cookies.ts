import { API_PREFIX, CSRF_COOKIE, REFRESH_COOKIE } from '@takawise/contracts';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/env';

/** Refresh cookie is only ever sent to the auth endpoints that need it (ADR-011). */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

function base(config: AppConfig): CookieOptions {
  return { secure: config.cookieSecure, sameSite: 'strict' };
}

export function refreshCookieOptions(config: AppConfig): CookieOptions {
  return {
    ...base(config),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

/**
 * Readable by the web app's JavaScript (double-submit CSRF). Holds no authority
 * by itself. COOKIE_DOMAIN lets app.example.com read a cookie set by api.example.com.
 */
export function csrfCookieOptions(config: AppConfig): CookieOptions {
  return {
    ...base(config),
    httpOnly: false,
    path: '/',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookies(
  res: Response,
  config: AppConfig,
  tokens: { refreshToken: string; csrfToken: string },
): void {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(config));
  res.cookie(CSRF_COOKIE, tokens.csrfToken, csrfCookieOptions(config));
}

export function clearSessionCookies(res: Response, config: AppConfig): void {
  const { maxAge: _a, ...refresh } = refreshCookieOptions(config);
  const { maxAge: _b, ...csrf } = csrfCookieOptions(config);
  res.clearCookie(REFRESH_COOKIE, refresh);
  res.clearCookie(CSRF_COOKIE, csrf);
}
