import type { BillingStatusResponse, PlanEntitlements } from '@takawise/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminGate } from '../admin/admin-views';
import { BillingView } from './billing-view';

const profile = { locale: 'en' as 'en' | 'bn', timezone: 'Asia/Dhaka', defaultCurrency: 'BDT' };
vi.mock('@/components/auth/auth-provider', () => ({
  useSession: () => ({ status: 'authenticated', user: { id: 'u1', profile } }),
}));

let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  usePathname: () => '/admin/tickets',
}));

const ok = (data: unknown) => ({ isPending: false, isError: false, data, refetch: vi.fn() });
const mutation = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false };

let billing: BillingStatusResponse;
let role: { isPending: boolean; isError: boolean; data?: string };
vi.mock('./queries', () => ({
  useBilling: () => ok(billing),
  useCheckout: () => mutation,
  useCompleteFakeCheckout: () => mutation,
  useCancelSubscription: () => mutation,
  useAdminRole: () => role,
}));

const FREE: PlanEntitlements = {
  maxAccounts: 10,
  aiInsights: true,
  aiDrafts: true,
  receiptOcr: false,
  familyWorkspace: false,
  maxFamilyMembers: 2,
};
const plan = (code: string, price: string, entitlements: PlanEntitlements, active = true) => ({
  code,
  name: code === 'FREE' ? 'Free' : code === 'PRO' ? 'Pro' : 'Family',
  priceAmount: price,
  currency: 'BDT',
  interval: 'MONTH' as const,
  active,
  entitlements,
});

beforeEach(() => {
  search = new URLSearchParams();
  billing = {
    plan: plan('FREE', '0.0000', FREE),
    subscription: null,
    entitlements: FREE,
    coveredBy: null,
    usage: { accounts: 4 },
    plans: [
      plan('FREE', '0.0000', FREE),
      plan('PRO', '299.0000', { ...FREE, maxAccounts: null, receiptOcr: true }),
    ],
    provider: 'none',
    checkoutEnabled: false,
  };
  role = { isPending: false, isError: false, data: 'NONE' };
});

describe('BillingView', () => {
  it('explains the plan, usage and that nothing is on sale yet', () => {
    render(<BillingView />);
    expect(screen.getByText('Your plan: Free')).toBeInTheDocument();
    expect(screen.getByText('Active accounts: 4 of 10')).toBeInTheDocument();
    expect(screen.getAllByText('Up to 10 active accounts').length).toBeGreaterThan(0);
    expect(screen.getByText(/Paid plans are not on sale yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose Pro' })).not.toBeInTheDocument();
    expect(screen.getByText(/never sees or stores card numbers/)).toBeInTheDocument();
  });

  it('offers checkout only when a provider is connected, and the dev payment only with the fake one', () => {
    billing = { ...billing, provider: 'fake', checkoutEnabled: true };
    search = new URLSearchParams('checkout=abc');
    render(<BillingView />);
    expect(screen.getByRole('button', { name: 'Choose Pro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate successful payment' })).toBeInTheDocument();
  });

  it('shows family cover', () => {
    billing = { ...billing, coveredBy: 'Rahman family' };
    render(<BillingView />);
    expect(screen.getByText(/family workspace “Rahman family”/)).toBeInTheDocument();
  });
});

describe('AdminGate', () => {
  it('shows nothing of the console to customers', () => {
    render(
      <AdminGate>
        <p>secret console</p>
      </AdminGate>,
    );
    expect(screen.getByText('Staff only')).toBeInTheDocument();
    expect(screen.queryByText('secret console')).not.toBeInTheDocument();
  });

  it('hides admin-only sections from support staff', () => {
    role = { isPending: false, isError: false, data: 'SUPPORT' };
    render(
      <AdminGate>
        <p>console</p>
      </AdminGate>,
    );
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Feature flags' })).not.toBeInTheDocument();
  });
});
