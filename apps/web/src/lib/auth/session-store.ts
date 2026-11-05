import type { MeResponse } from '@takawise/contracts';

/**
 * In-memory session (ADR-011): the access token never touches localStorage or
 * a readable cookie, so injected scripts cannot persist it. After a reload the
 * session is restored with a silent refresh (HttpOnly cookie).
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; accessToken: string; expiresAt: number; user: MeResponse };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

export function getSession(): SessionState {
  return state;
}

export function setSession(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests. */
export function resetSessionStore(): void {
  state = { status: 'loading' };
  listeners.clear();
}
