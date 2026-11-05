'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { refreshSession } from '@/lib/auth/auth-api';
import { getSession, type SessionState, subscribeSession } from '@/lib/auth/session-store';

const SERVER_SNAPSHOT: SessionState = { status: 'loading' };

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSession, () => SERVER_SNAPSHOT);
}

/** Restores the session after a page load via the HttpOnly refresh cookie. */
export function SessionBootstrap() {
  useEffect(() => {
    if (getSession().status === 'loading') void refreshSession();
  }, []);
  return null;
}

/**
 * Client-side gate for /app/*. This is UX only — the API authorises every request
 * itself (blueprint §3: UI hiding is not security).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [session.status, router, pathname]);

  if (session.status !== 'authenticated') {
    return (
      <div role="status" aria-live="polite" className="flex flex-1 items-center justify-center p-8">
        <span className="text-sm text-muted-foreground">Loading your account…</span>
      </div>
    );
  }
  return <>{children}</>;
}
