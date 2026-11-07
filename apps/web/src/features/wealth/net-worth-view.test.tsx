import { render, screen, within } from '@testing-library/react';
import type * as Recharts from 'recharts';
import { describe, expect, it, vi } from 'vitest';
import { NetWorthView } from './net-worth-view';

const profile = { locale: 'en' as 'en' | 'bn', timezone: 'Asia/Dhaka', defaultCurrency: 'BDT' };
vi.mock('@/components/auth/auth-provider', () => ({
  useSession: () => ({ status: 'authenticated', user: { profile } }),
}));

vi.mock('recharts', async (orig) => {
  const actual = await orig<typeof Recharts>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const ok = (data: unknown) => ({ isPending: false, isError: false, data, refetch: vi.fn() });
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

const netWorth = {
  asOf: '2026-11-07',
  currencies: [
    {
      currency: 'BDT',
      assets: '6062500.0000',
      liabilities: '100000.0000',
      netWorth: '5962500.0000',
      groups: [
        { group: 'CASH_AND_ACCOUNTS', side: 'ASSET', total: '50000.0000' },
        { group: 'INVESTMENTS', side: 'ASSET', total: '12500.0000' },
        { group: 'OTHER_ASSETS', side: 'ASSET', total: '6000000.0000' },
        { group: 'LOANS', side: 'LIABILITY', total: '100000.0000' },
      ],
      lines: [
        {
          source: 'ACCOUNT',
          id: 'a1',
          name: 'City Bank',
          type: 'BANK',
          group: 'CASH_AND_ACCOUNTS',
          side: 'ASSET',
          value: '50000.0000',
          recorded: '50000.0000',
          basis: 'RECORDED',
          valuedOn: null,
        },
        {
          source: 'ACCOUNT',
          id: 'a2',
          name: 'DSE shares',
          type: 'INVESTMENT',
          group: 'INVESTMENTS',
          side: 'ASSET',
          value: '12500.0000',
          recorded: '10000.0000',
          basis: 'ESTIMATED',
          valuedOn: '2026-10-01',
        },
        {
          source: 'ITEM',
          id: 'i1',
          name: 'Flat',
          type: null,
          group: 'OTHER_ASSETS',
          side: 'ASSET',
          value: '6000000.0000',
          recorded: null,
          basis: 'USER_ENTERED',
          valuedOn: '2026-10-01',
        },
        {
          source: 'ACCOUNT',
          id: 'l1',
          name: 'Personal loan',
          type: 'LOAN',
          group: 'LOANS',
          side: 'LIABILITY',
          value: '100000.0000',
          recorded: '100000.0000',
          basis: 'RECORDED',
          valuedOn: null,
        },
      ],
    },
  ],
};

vi.mock('./queries', () => ({
  useNetWorth: () => ok(netWorth),
  useNetWorthHistory: () =>
    ok({
      dates: ['2026-10-31', '2026-11-07'],
      series: [
        {
          currency: 'BDT',
          points: [
            {
              date: '2026-10-31',
              assets: '6000000.0000',
              liabilities: '100000.0000',
              netWorth: '5900000.0000',
            },
            {
              date: '2026-11-07',
              assets: '6062500.0000',
              liabilities: '100000.0000',
              netWorth: '5962500.0000',
            },
          ],
        },
      ],
    }),
  useNetWorthItems: () => ok([]),
  useCreateNetWorthItem: () => mutation,
  useArchiveNetWorthItem: () => mutation,
  useAddItemValuation: () => mutation,
}));

describe('NetWorthView', () => {
  it('shows totals from the API and labels how every value was obtained', () => {
    render(<NetWorthView />);
    expect(screen.getAllByText('৳5,962,500.00').length).toBeGreaterThan(0);

    const shares = screen.getByText('DSE shares').closest('li')!;
    expect(within(shares).getByText(/Estimate/)).toBeInTheDocument();
    const flat = screen.getByText('Flat').closest('li')!;
    expect(within(flat).getByText(/Your value/)).toBeInTheDocument();
    const bank = screen.getByText('City Bank').closest('li')!;
    expect(within(bank).getByText('Recorded')).toBeInTheDocument();
  });

  it('states that figures are user entries, not advice', () => {
    render(<NetWorthView />);
    expect(screen.getByText(/does not give investment advice/)).toBeInTheDocument();
  });

  it('offers the history as an accessible table', () => {
    render(<NetWorthView />);
    expect(screen.getAllByRole('table', { name: 'Net worth over time' }).length).toBeGreaterThan(0);
  });
});
