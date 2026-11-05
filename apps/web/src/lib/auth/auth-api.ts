import {
  type AcceptedResponse,
  acceptedResponseSchema,
  type AuthSessionResponse,
  authSessionResponseSchema,
  CSRF_COOKIE,
  CSRF_HEADER,
  type EmailOnlyRequest,
  type LoginRequest,
  type MeResponse,
  meResponseSchema,
  type RegisterRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from '@takawise/contracts';
import { ApiError, apiRequest, type ApiRequestOptions, type ApiResult } from '../api-client';
import { getSession, setSession } from './session-store';

/** Refresh slightly before expiry to avoid sending a token that dies in flight. */
const EXPIRY_SKEW_MS = 30_000;

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function csrfHeaders(): HeadersInit {
  const token = readCookie(CSRF_COOKIE);
  return token ? { [CSRF_HEADER]: token } : {};
}

function storeSession(body: AuthSessionResponse): AuthSessionResponse {
  setSession({
    status: 'authenticated',
    accessToken: body.accessToken,
    expiresAt: Date.parse(body.accessTokenExpiresAt),
    user: body.user,
  });
  return body;
}

// ─────────────────────────── Public flows ───────────────────────────

export async function register(body: RegisterRequest): Promise<AcceptedResponse> {
  return (
    await apiRequest('/auth/register', { method: 'POST', body, schema: acceptedResponseSchema })
  ).data;
}

export async function verifyEmail(body: VerifyEmailRequest): Promise<AuthSessionResponse> {
  const { data } = await apiRequest('/auth/verify-email', {
    method: 'POST',
    body,
    schema: authSessionResponseSchema,
  });
  return storeSession(data);
}

export async function resendVerification(body: EmailOnlyRequest): Promise<void> {
  await apiRequest('/auth/resend-verification', {
    method: 'POST',
    body,
    schema: acceptedResponseSchema,
  });
}

export async function login(body: LoginRequest): Promise<AuthSessionResponse> {
  const { data } = await apiRequest('/auth/login', {
    method: 'POST',
    body,
    schema: authSessionResponseSchema,
  });
  return storeSession(data);
}

export async function forgotPassword(body: EmailOnlyRequest): Promise<void> {
  await apiRequest('/auth/forgot-password', {
    method: 'POST',
    body,
    schema: acceptedResponseSchema,
  });
}

export async function resetPassword(body: ResetPasswordRequest): Promise<void> {
  await apiRequest('/auth/reset-password', {
    method: 'POST',
    body,
    schema: acceptedResponseSchema,
  });
}

// ──────────────────────────── Session ────────────────────────────

let inFlightRefresh: Promise<AuthSessionResponse | null> | null = null;

/**
 * Silent refresh using the HttpOnly cookie. Single-flight: concurrent callers
 * share one request, because the server treats a second use of a rotated
 * refresh token as theft and revokes the session family.
 */
export function refreshSession(): Promise<AuthSessionResponse | null> {
  inFlightRefresh ??= apiRequest('/auth/refresh', {
    method: 'POST',
    headers: csrfHeaders(),
    schema: authSessionResponseSchema,
  })
    .then(({ data }) => storeSession(data))
    .catch(() => {
      setSession({ status: 'anonymous' });
      return null;
    })
    .finally(() => {
      inFlightRefresh = null;
    });
  return inFlightRefresh;
}

async function currentAccessToken(): Promise<string | null> {
  const session = getSession();
  if (session.status === 'authenticated' && session.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return session.accessToken;
  }
  return (await refreshSession())?.accessToken ?? null;
}

/** Authenticated API call: attaches the access token and retries once after a refresh on 401. */
export async function authedRequest<T>(
  path: string,
  options: ApiRequestOptions<T> = {},
): Promise<ApiResult<T>> {
  const send = (token: string) => {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return apiRequest<T>(path, { ...options, headers });
  };

  const token = await currentAccessToken();
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
  try {
    return await send(token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const refreshed = await refreshSession();
    if (!refreshed) throw error;
    return send(refreshed.accessToken);
  }
}

export async function fetchMe(): Promise<MeResponse> {
  return (await authedRequest('/users/me', { schema: meResponseSchema })).data;
}

export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST', headers: csrfHeaders() });
  } finally {
    setSession({ status: 'anonymous' });
  }
}

/** Only allow same-site relative paths as post-login destinations (no open redirect). */
export function safeNextPath(next: string | null | undefined, fallback = '/app/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback;
  return next;
}
