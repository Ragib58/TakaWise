'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAV, type NavItem } from '@/config/navigation';
import { useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';

function isActive(pathname: string, item: NavItem): boolean {
  const base = item.match ?? item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Desktop sidebar navigation. */
export function SidebarNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {APP_NAV.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile bottom navigation (blueprint §9.4). */
export function BottomNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {APP_NAV.filter((item) => item.mobile).map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 text-[11px] font-medium',
                  active ? 'text-brand-teal' : 'text-muted-foreground',
                )}
              >
                <Icon aria-hidden className="size-5" />
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
