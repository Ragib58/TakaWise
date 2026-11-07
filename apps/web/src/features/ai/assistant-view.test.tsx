import type { AiStatusResponse, InsightResponse } from '@takawise/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantView, InsightResult } from './assistant-view';
import { formatFact } from './insight-parts';

const profile = { locale: 'en' as 'en' | 'bn', timezone: 'Asia/Dhaka', defaultCurrency: 'BDT' };
vi.mock('@/components/auth/auth-provider', () => ({
  useSession: () => ({ status: 'authenticated', user: { profile } }),
}));

const ok = (data: unknown) => ({ isPending: false, isError: false, data, refetch: vi.fn() });
const mutation = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  data: undefined,
};

let status: AiStatusResponse;
vi.mock('./queries', () => ({
  useAiStatus: () => ok(status),
  useSetConsent: () => mutation,
  useDeleteAiData: () => mutation,
  useInsight: () => mutation,
  useTextDraft: () => mutation,
  useReceiptDraft: () => mutation,
}));
vi.mock('../finance/queries', () => ({
  useAccountList: () => ok([]),
  useCreateTransaction: () => mutation,
}));
vi.mock('../planning/queries', () => ({ useCategories: () => ok([]) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const baseStatus = (over: Partial<AiStatusResponse> = {}): AiStatusResponse => ({
  enabled: true,
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  policyVersion: '2026-11-07',
  features: [
    'MONTHLY_SUMMARY',
    'UNUSUAL_SPENDING',
    'SAVINGS_SUGGESTIONS',
    'TRANSACTION_DRAFT',
    'RECEIPT_OCR',
  ],
  consents: [
    {
      scope: 'INSIGHTS',
      granted: true,
      grantedAt: '2026-11-07T10:00:00.000Z',
      policyVersion: '2026-11-07',
    },
    { scope: 'TRANSACTION_DRAFT', granted: false, grantedAt: null, policyVersion: null },
    { scope: 'RECEIPT_OCR', granted: false, grantedAt: null, policyVersion: null },
  ],
  usage: {
    requestsToday: 3,
    dailyRequestLimit: 30,
    tokensThisMonth: 1200,
    monthlyTokenLimit: 300000,
  },
  receiptMaxBytes: 4_000_000,
  ...over,
});

const insight: InsightResponse = {
  kind: 'MONTHLY_SUMMARY',
  month: '2026-10',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  currency: 'BDT',
  locale: 'en',
  status: 'READY',
  cached: true,
  generatedAt: '2026-11-07T10:00:00.000Z',
  model: 'claude-opus-5-5',
  dataScope: ['BUDGETS'],
  facts: [
    { id: 'expense', type: 'money', value: '150000.0000', labelEn: 'Spending', labelBn: 'খরচ' },
    {
      id: 'expense_change',
      type: 'percent',
      value: '-12.50',
      labelEn: 'Change',
      labelBn: 'পরিবর্তন',
    },
    { id: 'cat1_name', type: 'text', value: 'Groceries', labelEn: 'Top', labelBn: 'শীর্ষ' },
  ],
  headline: [
    { type: 'text', text: 'You spent ' },
    { type: 'fact', factId: 'expense' },
    { type: 'text', text: ', mostly on ' },
    { type: 'fact', factId: 'cat1_name' },
    { type: 'text', text: '.' },
  ],
  points: [
    [
      { type: 'text', text: 'Spending changed by ' },
      { type: 'fact', factId: 'expense_change' },
    ],
  ],
  limitations: ['RECORDED_DATA_ONLY', 'SINGLE_CURRENCY', 'CATEGORY_NAMES_WITHHELD'],
};

beforeEach(() => {
  profile.locale = 'en';
  status = baseStatus();
});

describe('AssistantView', () => {
  it('explains that AI is off when the operator has not enabled it', () => {
    status = baseStatus({ enabled: false, provider: null, model: null, features: [] });
    render(<AssistantView />);
    expect(screen.getByText(/not switched on/i)).toBeInTheDocument();
    expect(screen.queryByText('Privacy & consent')).not.toBeInTheDocument();
  });

  it('shows what each consent shares and gates features without consent', () => {
    render(<AssistantView />);
    expect(
      screen.getByText(/Never transaction notes, account names or account numbers/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The photo is never stored/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Turn off: Monthly insights/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Allow: Scan a receipt/ })).toBeInTheDocument();
    // Insights allowed → controls; drafts not allowed → hint instead of a form.
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument();
    expect(screen.queryByLabelText('What happened?')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Allow this feature under Privacy & consent/)).toHaveLength(2);
    expect(screen.getByText(/information only, not financial/i)).toBeInTheDocument();
  });
});

describe('InsightResult', () => {
  it('formats every number from backend facts and lists limitations and scope', () => {
    render(<InsightResult data={insight} />);
    const headline = screen.getByText(/You spent/).closest('p')!;
    expect(within(headline).getByText('৳150,000.00')).toBeInTheDocument();
    expect(within(headline).getByText('Groceries')).toBeInTheDocument();
    // In the prose and in the figures table.
    expect(screen.getAllByText('-12.5%')).toHaveLength(2);
    expect(screen.getByText(/Category names were not shared/)).toBeInTheDocument();
    expect(screen.getByText(/Only BDT is included/)).toBeInTheDocument();
    expect(screen.getByText(/Shared with the AI: monthly totals, budgets/)).toBeInTheDocument();
    expect(screen.getByText(/Saved answer/)).toBeInTheDocument();
  });

  it('uses Bangla digits and lakh grouping in Bangla', () => {
    expect(formatFact(insight.facts[0]!, 'BDT', 'bn')).toBe('১,৫০,০০০.০০৳');
  });

  it('shows a plain message instead of prose when there is nothing to explain', () => {
    render(
      <InsightResult data={{ ...insight, status: 'NOTHING_UNUSUAL', headline: [], points: [] }} />,
    );
    expect(screen.getByText(/Nothing stood out/)).toBeInTheDocument();
  });
});
