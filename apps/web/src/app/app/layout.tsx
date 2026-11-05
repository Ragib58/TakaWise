import Link from 'next/link';
import type { ReactNode } from 'react';
import { BottomNav, SidebarNav } from '@/components/layout/app-nav';

/**
 * Authenticated application shell: sidebar + top bar on desktop, compact header +
 * bottom navigation on mobile. Auth guarding is added in Phase 3.
 */
export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r bg-card p-4 md:flex">
        <Link href="/app/dashboard" className="px-3 text-lg font-bold tracking-tight text-primary">
          TakaWise
        </Link>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-card/95 px-4 backdrop-blur">
          <span className="font-semibold text-primary md:hidden">TakaWise</span>
        </header>
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
