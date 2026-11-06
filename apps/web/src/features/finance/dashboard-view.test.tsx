import { fireEvent, render, screen, within } from '@testing-library/react';
import type * as Recharts from 'recharts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashFlowChart } from '@/components/charts/charts';
import { DashboardView } from './dashboard-view';

const profile = { locale: 'en' as 'en' | 'bn', timezone: 'Asia/Dhaka', defaultCurrency: 'BDT' };
vi.mock('@/components/auth/auth-provider', () => ({
  useSession: () => ({ status: 'authenticated', user: { profile } }),
}));

const result: { isPending: boolean; isError: boolean; data: unknown; refetch: () => void } = {
  isPending: false,
  isError: false,
  data: null,
  refetch: vi.fn(),
};
vi.mock('./queries', () => ({ useDashboard: () => result }));

// Recharts measures the DOM; jsdom has no layout.
vi.mock('recharts', async (orig) => {
  const actual = await orig<typeof Recharts>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const dashboard = {
  month: '2026-11',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  currency: 'BDT',
  otherCurrencies: ['USD'],
  netBalance: '63800.0000',
  assets: '63800.0000',
  liabilities: '0.0000',
  income: '52000.0000',
  expense: '3200.0000',
  netCashFlow: '48800.0000',
  previous: {
    month: '2026-10',
    income: '50000.0000',
    expense: '5500.0000',
    netCashFlow: '44500.0000',
  },
  topExpenseCategories: [
    {
      id: 'c1',
      nameEn: 'Food & Dining',
      nameBn: 'খাবার ও রেস্তোরাঁ',
      parentId: null,
      total: '2500.0000',
      share: '78.13',
    },
  ],
  budget: null,
  goals: [],
  recentTransactions: [],
  upcomingReminders: [],
};

describe('DashboardView', () => {
  beforeEach(() => {
    profile.locale = 'en';
    result.data = dashboard;
  });

  it('shows server-calculated totals with last-month context', () => {
    render(<DashboardView />);
    expect(screen.getByText('৳63,800.00')).toBeInTheDocument();
    expect(screen.getByText('৳52,000.00')).toBeInTheDocument();
    expect(screen.getByText('Last month: ৳50,000.00')).toBeInTheDocument();
    // Positive cash flow carries a sign, not only colour.
    expect(screen.getByText('+৳48,800.00')).toBeInTheDocument();
    expect(screen.getByText(/You also hold USD/)).toBeInTheDocument();
    expect(screen.getByText('No budget for this month.')).toBeInTheDocument();
  });

  it('renders in Bangla with Bangla digits', () => {
    profile.locale = 'bn';
    render(<DashboardView />);
    expect(screen.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeInTheDocument();
    expect(screen.getByText('৬৩,৮০০.০০৳')).toBeInTheDocument();
    expect(screen.getByText('খাবার ও রেস্তোরাঁ')).toBeInTheDocument();
  });

  it('shows a retry on error', () => {
    result.data = undefined;
    result.isError = true;
    render(<DashboardView />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(result.refetch).toHaveBeenCalled();
    result.isError = false;
  });
});

describe('CashFlowChart accessibility', () => {
  it('always exposes the numbers as a table and can switch to it', () => {
    render(
      <CashFlowChart
        currency="BDT"
        months={[
          { month: '2026-11', income: '52000.0000', expense: '3200.0000', net: '48800.0000' },
        ]}
      />,
    );
    // Screen-reader table is present even in chart mode.
    const table = screen.getByRole('table', { name: 'Income vs spending' });
    expect(within(table).getByRole('rowheader', { name: 'November 2026' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByRole('button', { name: 'Show as chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(screen.getByRole('table')).getByText('৳48,800.00')).toBeInTheDocument();
  });
});
