import {
  ArrowLeftRight,
  Bell,
  ChartPie,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Settings,
  Target,
  Wallet,
} from 'lucide-react';
import type { MessageKey } from '@/lib/i18n/messages';

export type NavItem = {
  href: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Shown in the mobile bottom navigation (max 5). */
  mobile?: boolean;
  /** Section prefix used for the active state (defaults to href). */
  match?: string;
};

export const APP_NAV: NavItem[] = [
  { href: '/app/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, mobile: true },
  { href: '/app/transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight, mobile: true },
  { href: '/app/accounts', labelKey: 'nav.accounts', icon: Wallet, mobile: true },
  { href: '/app/budgets', labelKey: 'nav.budgets', icon: PiggyBank, mobile: true },
  { href: '/app/goals', labelKey: 'nav.goals', icon: Target },
  { href: '/app/reports', labelKey: 'nav.reports', icon: ChartPie },
  { href: '/app/reminders', labelKey: 'nav.reminders', icon: Bell },
  { href: '/app/notifications', labelKey: 'nav.notifications', icon: Inbox },
  {
    href: '/app/settings/profile',
    labelKey: 'nav.settings',
    icon: Settings,
    mobile: true,
    match: '/app/settings',
  },
];
