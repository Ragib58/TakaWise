'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AdminAnalyticsResponse,
  type AdminTicketResponse,
  type AdminUserResponse,
  type BillingStatusResponse,
  billingStatusResponseSchema,
  type CheckoutResponse,
  type CreateShareRequest,
  type CreateTicketRequest,
  type GrantSubscriptionRequest,
  type InviteMemberRequest,
  type PlanResponse,
  type PlatformRole,
  type SharedResource,
  type TicketResponse,
  type UpdatePlanRequest,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from '@takawise/contracts';
import { authedRequest } from '@/lib/auth/auth-api';
import { useInvalidateFinance } from '../finance/queries';

/** Phase 10 server state: billing, family, support and the admin console. */

const get = async <T>(path: string) => (await authedRequest<T>(path)).data;
const send = async <T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  (await authedRequest<T>(path, { method, body: method === 'DELETE' ? undefined : (body ?? {}) }))
    .data;

function useMutateAndRefresh<TVars, TResult>(
  keys: string[][],
  fn: (vars: TVars) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

// ─────────────────────────────── Billing ───────────────────────────────

export function useBilling() {
  return useQuery({
    queryKey: ['billing'],
    queryFn: async () =>
      (
        await authedRequest<BillingStatusResponse>('/billing', {
          schema: billingStatusResponseSchema,
        })
      ).data,
  });
}

export function useFeatures() {
  return useQuery({
    queryKey: ['features'],
    queryFn: () => get<Record<string, boolean>>('/features'),
    staleTime: 60_000,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (planCode: string) =>
      send<CheckoutResponse>('POST', '/billing/checkout', { planCode }),
  });
}

export function useCompleteFakeCheckout() {
  const invalidate = useInvalidateFinance();
  return useMutateAndRefresh([['billing']], async (checkoutId: string) => {
    const r = await send<BillingStatusResponse>('POST', `/billing/fake/complete/${checkoutId}`);
    await invalidate();
    return r;
  });
}

export function useCancelSubscription() {
  return useMutateAndRefresh([['billing']], () =>
    send<BillingStatusResponse>('POST', '/billing/subscription/cancel'),
  );
}

// ─────────────────────────────── Family ───────────────────────────────

const FAMILY = ['family'];

export function useWorkspaces() {
  return useQuery({
    queryKey: FAMILY,
    queryFn: () => get<WorkspaceSummary[]>('/family/workspaces'),
  });
}

export function useWorkspace(id: string | null) {
  return useQuery({
    queryKey: [...FAMILY, id],
    queryFn: () => get<WorkspaceDetail>(`/family/workspaces/${id}`),
    enabled: !!id,
  });
}

export function useShared(id: string | null) {
  return useQuery({
    queryKey: [...FAMILY, id, 'shared'],
    queryFn: () => get<SharedResource[]>(`/family/workspaces/${id}/shared`),
    enabled: !!id,
  });
}

export const useCreateWorkspace = () =>
  useMutateAndRefresh([FAMILY, ['billing']], (name: string) =>
    send<WorkspaceDetail>('POST', '/family/workspaces', { name }),
  );

export const useAcceptInvitation = () =>
  useMutateAndRefresh([FAMILY, ['billing']], (code: string) =>
    send<WorkspaceDetail>('POST', '/family/invitations/accept', { code }),
  );

export const useInvite = (id: string) =>
  useMutateAndRefresh([FAMILY], (body: InviteMemberRequest) =>
    send<WorkspaceDetail>('POST', `/family/workspaces/${id}/invitations`, body),
  );

export const useRevokeInvitation = (id: string) =>
  useMutateAndRefresh([FAMILY], (invitationId: string) =>
    send<WorkspaceDetail>('DELETE', `/family/workspaces/${id}/invitations/${invitationId}`),
  );

export const useRemoveMember = (id: string) =>
  useMutateAndRefresh([FAMILY, ['billing']], (userId: string) =>
    send<void>('DELETE', `/family/workspaces/${id}/members/${userId}`),
  );

export const useShare = (id: string) =>
  useMutateAndRefresh([FAMILY], (body: CreateShareRequest) =>
    send<WorkspaceDetail>('POST', `/family/workspaces/${id}/shares`, body),
  );

export const useUnshare = (id: string) =>
  useMutateAndRefresh([FAMILY], (shareId: string) =>
    send<WorkspaceDetail>('DELETE', `/family/workspaces/${id}/shares/${shareId}`),
  );

export const useDeleteWorkspace = () =>
  useMutateAndRefresh([FAMILY, ['billing']], (id: string) =>
    send<void>('DELETE', `/family/workspaces/${id}`),
  );

// ─────────────────────────────── Support ───────────────────────────────

export function useMyTickets() {
  return useQuery({
    queryKey: ['tickets'],
    queryFn: () => get<TicketResponse[]>('/support/tickets'),
  });
}

export const useCreateTicket = () =>
  useMutateAndRefresh([['tickets']], (body: CreateTicketRequest) =>
    send<TicketResponse>('POST', '/support/tickets', body),
  );

export const useReplyTicket = () =>
  useMutateAndRefresh([['tickets']], ({ id, body }: { id: string; body: string }) =>
    send<TicketResponse>('POST', `/support/tickets/${id}/messages`, { body }),
  );

// ─────────────────────────────── Admin ───────────────────────────────

export function useAdminRole() {
  return useQuery({
    queryKey: ['admin', 'me'],
    queryFn: async () => (await get<{ role: PlatformRole }>('/admin/me')).role,
    retry: false,
  });
}

export const useAdminAnalytics = () =>
  useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn: () => get<AdminAnalyticsResponse>('/admin/analytics'),
  });

export const useAdminPlans = () =>
  useQuery({ queryKey: ['admin', 'plans'], queryFn: () => get<PlanResponse[]>('/admin/plans') });

export const useUpdatePlan = () =>
  useMutateAndRefresh(
    [['admin', 'plans']],
    ({ code, body }: { code: string; body: UpdatePlanRequest }) =>
      send<PlanResponse>('PATCH', `/admin/plans/${code}`, body),
  );

export const useAdminFlags = () =>
  useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: () =>
      get<Array<{ key: string; enabled: boolean; description: string; updatedAt: string }>>(
        '/admin/feature-flags',
      ),
  });

export const useSetFlag = () =>
  useMutateAndRefresh(
    [['admin', 'flags'], ['features']],
    ({ key, enabled }: { key: string; enabled: boolean }) =>
      send<unknown>('PATCH', `/admin/feature-flags/${key}`, { enabled }),
  );

export const useAdminTickets = (status?: string) =>
  useQuery({
    queryKey: ['admin', 'tickets', status ?? 'ALL'],
    queryFn: () => get<AdminTicketResponse[]>(`/admin/tickets${status ? `?status=${status}` : ''}`),
  });

export const useStaffReply = () =>
  useMutateAndRefresh([['admin', 'tickets']], ({ id, body }: { id: string; body: string }) =>
    send<AdminTicketResponse>('POST', `/admin/tickets/${id}/messages`, { body }),
  );

export const useTicketStatus = () =>
  useMutateAndRefresh([['admin', 'tickets']], ({ id, status }: { id: string; status: string }) =>
    send<AdminTicketResponse>('PATCH', `/admin/tickets/${id}`, { status }),
  );

export function useLookupUser() {
  return useMutation({
    mutationFn: (email: string) =>
      get<AdminUserResponse>(`/admin/users?email=${encodeURIComponent(email)}`),
  });
}

export function useAdminUserActions() {
  const grant = useMutation({
    mutationFn: ({ id, body }: { id: string; body: GrantSubscriptionRequest }) =>
      send<AdminUserResponse>('POST', `/admin/users/${id}/subscription`, body),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      send<AdminUserResponse>('DELETE', `/admin/users/${id}/subscription`),
  });
  const role = useMutation({
    mutationFn: ({ id, role }: { id: string; role: PlatformRole }) =>
      send<AdminUserResponse>('PATCH', `/admin/users/${id}/role`, { role }),
  });
  return { grant, cancel, role };
}
