import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetsView } from './budgets-view';

vi.mock('@/components/auth/auth-provider', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { profile: { locale: 'en', timezone: 'Asia/Dhaka' } },
  }),
}));

const budgetsResult = { isPending: false, isError: false, data: [] as unknown[], refetch: vi.fn() };
vi.mock('./queries', () => ({
  useBudgets: () => budgetsResult,
  useCategories: () => ({ data: [] }),
  useCreateBudget: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveBudget: () => ({ mutate: vi.fn(), isPending: false }),
}));

const budget = {
  id: 'b1',
  name: 'Budget 2026-11',
  month: '2026-11',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  currency: 'BDT',
  archived: false,
  totalSpent: '4500.0000',
  overall: {
    limit: '10000.0000',
    spent: '4500.0000',
    remaining: '5500.0000',
    percentUsed: '45.00',
    status: 'ok',
  },
  items: [
    {
      id: 'i1',
      category: { id: 'c1', nameEn: 'Utilities', nameBn: 'ইউটিলিটি বিল' },
      limit: '2000.0000',
      spent: '2300.0000',
      remaining: '-300.0000',
      percentUsed: '115.00',
      status: 'over',
    },
  ],
};

describe('BudgetsView', () => {
  beforeEach(() => {
    budgetsResult.data = [];
  });

  it('shows utilization with text, not colour alone', () => {
    budgetsResult.data = [budget];
    render(<BudgetsView />);

    expect(screen.getByText('৳4,500.00 of ৳10,000.00')).toBeInTheDocument();
    expect(screen.getByText('Over by ৳300.00')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Utilities budget used' });
    expect(bar).toHaveAttribute('aria-valuenow', '100'); // capped visually
    expect(bar).toHaveAttribute('aria-valuetext', '115.00% — Over limit');
  });

  it('offers to create a budget when the month has none', () => {
    render(<BudgetsView />);
    expect(screen.getByText(/No budget for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeInTheDocument();
  });
});
