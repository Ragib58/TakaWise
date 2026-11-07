'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  CreateInvestmentRequest,
  CreateLoanPaymentRequest,
  CreateLoanRequest,
  CreateNetWorthItemRequest,
  CreateReminderRequest,
  CreateTransactionRequest,
  CreateTransferRequest,
  CreateValuationRequest,
  InvestmentDetailResponse,
  InvestmentResponse,
  LoanDetailResponse,
  LoanResponse,
  NetWorthHistoryResponse,
  NetWorthItemResponse,
  NetWorthResponse,
  ReminderResponse,
} from '@takawise/contracts';
import { authedRequest } from '@/lib/auth/auth-api';
import { useInvalidateFinance } from '../finance/queries';

/**
 * Server state for investments, loans and net worth (Phase 8). Every figure
 * comes from the API; the browser never adds up money.
 */

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

/** Any wealth change can move balances, reports and net worth: refresh them all. */
function useMutate<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateFinance();
  return useMutation({ mutationFn: fn, onSuccess: invalidate });
}

// ───────────────────────────── Investments ─────────────────────────────

export const useInvestments = () =>
  useQuery({
    queryKey: ['investments', 'list'],
    queryFn: () => get<InvestmentResponse[]>('/investments?status=ALL'),
  });

export const useInvestment = (id: string | null) =>
  useQuery({
    queryKey: ['investments', id],
    queryFn: () => get<InvestmentDetailResponse>(`/investments/${id}`),
    enabled: id !== null,
  });

export const useCreateInvestment = () =>
  useMutate(({ body, key }: { body: CreateInvestmentRequest; key: string }) =>
    send<InvestmentDetailResponse>('POST', '/investments', body, key),
  );

export const useArchiveInvestment = () =>
  useMutate(({ id, archived }: { id: string; archived: boolean }) =>
    send<InvestmentDetailResponse>(
      'POST',
      `/investments/${id}/${archived ? 'archive' : 'restore'}`,
    ),
  );

export const useAddInvestmentValuation = (id: string) =>
  useMutate((body: CreateValuationRequest) =>
    send<InvestmentDetailResponse>('POST', `/investments/${id}/valuations`, body),
  );

export const useDeleteInvestmentValuation = (id: string) =>
  useMutate((valuationId: string) =>
    send<InvestmentDetailResponse>('DELETE', `/investments/${id}/valuations/${valuationId}`),
  );

/** Money in/out of an investment is an ordinary transfer (ADR-022). */
export const useWealthTransfer = () =>
  useMutate(({ body, key }: { body: CreateTransferRequest; key: string }) =>
    send('POST', '/transfers', body, key),
  );

/** Profit / interest earned is ordinary income on the investment account. */
export const useWealthIncome = () =>
  useMutate(({ body, key }: { body: CreateTransactionRequest; key: string }) =>
    send('POST', '/transactions', body, key),
  );

// ─────────────────────────────── Loans ───────────────────────────────

export const useLoans = () =>
  useQuery({
    queryKey: ['loans', 'list'],
    queryFn: () => get<LoanResponse[]>('/loans?status=ALL'),
  });

export const useLoan = (id: string | null) =>
  useQuery({
    queryKey: ['loans', id],
    queryFn: () => get<LoanDetailResponse>(`/loans/${id}`),
    enabled: id !== null,
  });

export const useCreateLoan = () =>
  useMutate(({ body, key }: { body: CreateLoanRequest; key: string }) =>
    send<LoanDetailResponse>('POST', '/loans', body, key),
  );

export const useArchiveLoan = () =>
  useMutate(({ id, archived }: { id: string; archived: boolean }) =>
    send<LoanDetailResponse>('POST', `/loans/${id}/${archived ? 'archive' : 'restore'}`),
  );

export const useLoanPayment = (id: string) =>
  useMutate(({ body, key }: { body: CreateLoanPaymentRequest; key: string }) =>
    send<LoanDetailResponse>('POST', `/loans/${id}/payments`, body, key),
  );

export const useReverseLoanPayment = (id: string) =>
  useMutate(({ paymentId, key }: { paymentId: string; key: string }) =>
    send<LoanDetailResponse>('POST', `/loans/${id}/payments/${paymentId}/reverse`, {}, key),
  );

export const useLoanReminder = () =>
  useMutation({
    mutationFn: (body: CreateReminderRequest) => send<ReminderResponse>('POST', '/reminders', body),
  });

// ───────────────────────────── Net worth ─────────────────────────────

export const useNetWorth = () =>
  useQuery({ queryKey: ['net-worth', 'now'], queryFn: () => get<NetWorthResponse>('/net-worth') });

export const useNetWorthHistory = (months: number) =>
  useQuery({
    queryKey: ['net-worth', 'history', months],
    queryFn: () => get<NetWorthHistoryResponse>(`/net-worth/history?months=${months}`),
  });

export const useNetWorthItems = () =>
  useQuery({
    queryKey: ['net-worth', 'items'],
    queryFn: () => get<NetWorthItemResponse[]>('/net-worth/items?status=ALL'),
  });

export const useCreateNetWorthItem = () =>
  useMutate((body: CreateNetWorthItemRequest) =>
    send<NetWorthItemResponse>('POST', '/net-worth/items', body),
  );

export const useArchiveNetWorthItem = () =>
  useMutate(({ id, archived }: { id: string; archived: boolean }) =>
    send<NetWorthItemResponse>(
      'POST',
      `/net-worth/items/${id}/${archived ? 'archive' : 'restore'}`,
    ),
  );

export const useAddItemValuation = (id: string) =>
  useMutate((body: CreateValuationRequest) =>
    send<NetWorthItemResponse>('POST', `/net-worth/items/${id}/valuations`, body),
  );
