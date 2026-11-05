import {
  ArrowLeftRight,
  Bell,
  ChartPie,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Settings,
  Target,
  Wallet,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom navigation (max 5). */
  mobile?: boolean;
};

export const APP_NAV: NavItem[] = [
  { href: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, mobile: true },
  { href: '/app/transactions', label: 'Transactions', icon: ArrowLeftRight, mobile: true },
  { href: '/app/accounts', label: 'Accounts', icon: Wallet, mobile: true },
  { href: '/app/budgets', label: 'Budgets', icon: PiggyBank, mobile: true },
  { href: '/app/goals', label: 'Goals', icon: Target },
  { href: '/app/reports', label: 'Reports', icon: ChartPie },
  { href: '/app/reminders', label: 'Reminders', icon: Bell },
  { href: '/app/settings/profile', label: 'Settings', icon: Settings, mobile: true },
];
