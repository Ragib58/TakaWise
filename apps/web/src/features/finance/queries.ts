'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountReportResponse,
  AccountResponse,
  CashFlowResponse,
  CategoryReportResponse,
  ChangePasswordRequest,
  CreateAccountRequest,
  CreateTransactionRequest,
  CreateTransferRequest,
  DashboardResponse,
  MeResponse,
  PaginationMeta,
  PostedTransactionResponse,
  SessionSummary,
  TransactionResponse,
  TransferResponse,
  UpdateMeRequest,
} from '@takawise/contracts';
import { API_BASE_URL, ApiError } from '@/lib/api-client';
import { authedRequest } from '@/lib/auth/auth-api';
import { getSession, setSession } from '@/lib/auth/session-store';

/** Server state for dashboard, accounts, transactions, reports and settings. */

const get = async <T>(path: string) => (await authedRequest<T>(path)).data;
const send = async <T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown = {},
  key?: string,
) =>
  (
    await authedRequest<T>(path, {
      method,
      body: method === 'DELETE' ? undefined : body,
      headers: key ? { 'Idempotency-Key': key } : undefined,
    })
  ).data;

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

/** Everything that depends on ledger data; invalidated after any posting. */
const FINANCE_KEYS = [
  ['accounts'],
  ['transactions'],
  ['transfers'],
  ['dashboard'],
  ['reports'],
  ['budgets'],
  ['goals'],
];

function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => Promise.all(FINANCE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

// ───────────────────────────── Dashboard / reports ─────────────────────────────

export const useDashboard = (month: string) =>
  useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => get<DashboardResponse>(`/dashboard/overview${qs({ month })}`),
    placeholderData: keepPreviousData,
  });

export const useCashFlow = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'cash-flow', from, to],
    queryFn: () => get<CashFlowResponse>(`/reports/cash-flow${qs({ from, to })}`),
    placeholderData: keepPreviousData,
  });

export const useCategoryReport = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'categories', from, to],
    queryFn: () => get<CategoryReportResponse>(`/reports/categories${qs({ from, to })}`),
    placeholderData: keepPreviousData,
  });

export const useAccountReport = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'accounts', from, to],
    queryFn: () => get<AccountReportResponse>(`/reports/accounts${qs({ from, to })}`),
    placeholderData: keepPreviousData,
  });

/** Downloads the CSV with the bearer token (a plain link cannot carry it). */
export async function downloadTransactionsCsv(range: {
  from?: string;
  to?: string;
}): Promise<void> {
  const session = getSession();
  if (session.status !== 'authenticated')
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in.');
  const res = await fetch(`${API_BASE_URL}/exports/transactions${qs(range)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, 'BAD_REQUEST', 'Export failed. Please try again.');
  const blob = await res.blob();
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    'takawise-transactions.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────── Accounts ───────────────────────────────

export const useAccountList = (status: 'ACTIVE' | 'ALL' = 'ACTIVE') =>
  useQuery({
    queryKey: ['accounts', status],
    queryFn: () => get<AccountResponse[]>(`/accounts?status=${status}`),
  });

export function useCreateAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateAccountRequest; key: string }) =>
      send<AccountResponse>('POST', '/accounts', body, key),
    onSuccess: invalidate,
  });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      send<AccountResponse>('POST', `/accounts/${id}/${archived ? 'archive' : 'restore'}`),
    onSuccess: invalidate,
  });
}

export function useCreateTransfer() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateTransferRequest; key: string }) =>
      send<TransferResponse>('POST', '/transfers', body, key),
    onSuccess: invalidate,
  });
}

// ───────────────────────────── Transactions ─────────────────────────────

export type TransactionFilters = {
  type?: 'INCOME' | 'EXPENSE';
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  q?: string;
  page: number;
};

export const useTransactionList = (filters: TransactionFilters) =>
  useQuery({
    queryKey: ['transactions', filters],
    queryFn: async () => {
      const res = await authedRequest<TransactionResponse[]>(
        `/transactions${qs({ ...filters, pageSize: 20 })}`,
      );
      return { items: res.data, meta: res.meta as PaginationMeta };
    },
    placeholderData: keepPreviousData,
  });

export function useCreateTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateTransactionRequest; key: string }) =>
      send<PostedTransactionResponse>('POST', '/transactions', body, key),
    onSuccess: invalidate,
  });
}

export function useReverseTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      send<PostedTransactionResponse>('POST', `/transactions/${id}/reverse`, {}, key),
    onSuccess: invalidate,
  });
}

// ─────────────────────────────── Settings ───────────────────────────────

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) => send<MeResponse>('PATCH', '/users/me', body),
    onSuccess: async (user) => {
      // Locale/time zone/currency drive formatting everywhere: refresh the session copy.
      const session = getSession();
      if (session.status === 'authenticated') setSession({ ...session, user });
      await qc.invalidateQueries();
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => send('POST', '/users/me/password', body),
  });
}

export const useSessions = () =>
  useQuery({ queryKey: ['sessions'], queryFn: () => get<SessionSummary[]>('/auth/sessions') });

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send('DELETE', `/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
