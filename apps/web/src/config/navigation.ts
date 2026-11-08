import {
  ArrowLeftRight,
  Bell,
  ChartPie,
  HandCoins,
  CreditCard,
  Inbox,
  LifeBuoy,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Scale,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Users,
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
  { href: '/app/investments', labelKey: 'nav.investments', icon: TrendingUp },
  { href: '/app/loans', labelKey: 'nav.loans', icon: HandCoins },
  { href: '/app/net-worth', labelKey: 'nav.netWorth', icon: Scale },
  { href: '/app/assistant', labelKey: 'nav.assistant', icon: Sparkles },
  { href: '/app/family', labelKey: 'nav.family', icon: Users },
  { href: '/app/reminders', labelKey: 'nav.reminders', icon: Bell },
  { href: '/app/notifications', labelKey: 'nav.notifications', icon: Inbox },
  { href: '/app/billing', labelKey: 'nav.billing', icon: CreditCard },
  { href: '/app/support', labelKey: 'nav.support', icon: LifeBuoy },
  {
    href: '/app/settings/profile',
    labelKey: 'nav.settings',
    icon: Settings,
    mobile: true,
    match: '/app/settings',
  },
];
