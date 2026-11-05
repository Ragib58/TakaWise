'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AccountResponse,
  type BudgetResponse,
  type CategoryResponse,
  type CreateBudgetRequest,
  type CreateContributionRequest,
  type CreateGoalRequest,
  type CreateReminderRequest,
  type GoalDetailResponse,
  type GoalResponse,
  type NotificationResponse,
  type ReminderResponse,
} from '@takawise/contracts';
import { authedRequest } from '@/lib/auth/auth-api';

/** Server state for Phase 5 screens. All calculations come from the API. */

export const keys = {
  accounts: ['accounts'] as const,
  categories: (type?: string) => ['categories', type ?? 'all'] as const,
  budgets: (month: string) => ['budgets', month] as const,
  goals: ['goals'] as const,
  goal: (id: string) => ['goals', id] as const,
  reminders: (view: string) => ['reminders', view] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
};

const get = async <T>(path: string) => (await authedRequest<T>(path)).data;
const send = async <T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown = {},
  headers?: HeadersInit,
) => (await authedRequest<T>(path, { method, body, headers })).data;

export const useAccounts = () =>
  useQuery({ queryKey: keys.accounts, queryFn: () => get<AccountResponse[]>('/accounts') });

export const useCategories = (type?: 'INCOME' | 'EXPENSE') =>
  useQuery({
    queryKey: keys.categories(type),
    queryFn: () => get<CategoryResponse[]>(`/categories${type ? `?type=${type}` : ''}`),
    staleTime: 5 * 60_000,
  });

export const useBudgets = (month: string) =>
  useQuery({
    queryKey: keys.budgets(month),
    queryFn: () => get<BudgetResponse[]>(`/budgets?month=${month}`),
  });

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBudgetRequest) => send<BudgetResponse>('POST', '/budgets', body),
    onSuccess: (budget) => qc.invalidateQueries({ queryKey: keys.budgets(budget.month) }),
  });
}

export function useArchiveBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<BudgetResponse>('POST', `/budgets/${id}/archive`),
    onSuccess: (budget) => qc.invalidateQueries({ queryKey: keys.budgets(budget.month) }),
  });
}

export const useGoals = () =>
  useQuery({ queryKey: keys.goals, queryFn: () => get<GoalResponse[]>('/goals?status=ALL') });

export const useGoal = (id: string | null) =>
  useQuery({
    queryKey: keys.goal(id ?? 'none'),
    queryFn: () => get<GoalDetailResponse>(`/goals/${id}`),
    enabled: id !== null,
  });

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGoalRequest) => send<GoalResponse>('POST', '/goals', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.goals }),
  });
}

/**
 * The caller supplies the Idempotency-Key and keeps it for retries of the same
 * attempt, so a double-click or network retry never double-counts (ADR-006).
 */
export function useContribute(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateContributionRequest; key: string }) =>
      send<GoalDetailResponse>('POST', `/goals/${goalId}/contributions`, body, {
        'Idempotency-Key': key,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.goals }),
  });
}

export function useReverseContribution(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contributionId, key }: { contributionId: string; key: string }) =>
      send<GoalDetailResponse>(
        'POST',
        `/goals/${goalId}/contributions/${contributionId}/reverse`,
        {},
        {
          'Idempotency-Key': key,
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.goals }),
  });
}

export const useReminders = (view: 'upcoming' | 'past_due' | 'done') =>
  useQuery({
    queryKey: keys.reminders(view),
    queryFn: () => get<ReminderResponse[]>(`/reminders?view=${view}&pageSize=100`),
  });

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReminderRequest) => send<ReminderResponse>('POST', '/reminders', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function useReminderAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'complete' | 'cancel' }) =>
      send<ReminderResponse>('POST', `/reminders/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => get<NotificationResponse[]>('/notifications?pageSize=50'),
  });

export const useUnreadCount = () =>
  useQuery({
    queryKey: keys.unread,
    queryFn: () => get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    /** A notification id, or the literal "all" to mark everything read. */
    mutationFn: (id: string) =>
      id === 'all'
        ? send('POST', '/notifications/read-all')
        : send('POST', `/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}
