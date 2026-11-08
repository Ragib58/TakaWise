import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RequireAuth, SessionBootstrap } from '@/components/auth/auth-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { AdminGate } from '@/features/admin/admin-views';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · TakaWise admin' },
  robots: { index: false },
};

/**
 * Separate route group for staff (blueprint §9.3, ADR-027): its own shell, no
 * customer navigation. Every action is authorised again by the API.
 */
export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <SessionBootstrap />
      <header className="flex items-center justify-between border-b pb-3">
        <span className="text-lg font-bold tracking-tight text-primary">TakaWise admin</span>
        <Link href="/app/dashboard" className="text-sm underline">
          Back to the app
        </Link>
      </header>
      <QueryProvider>
        <RequireAuth>
          <AdminGate>{children}</AdminGate>
        </RequireAuth>
      </QueryProvider>
    </div>
  );
}
