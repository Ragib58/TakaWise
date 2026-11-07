'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_POLICY_VERSION,
  type AiConsentScope,
  type AiStatusResponse,
  aiStatusResponseSchema,
  type DeleteAiDataResponse,
  type DraftResponse,
  draftResponseSchema,
  type InsightRequest,
  type InsightResponse,
  insightResponseSchema,
  type TransactionDraftRequest,
} from '@takawise/contracts';
import { authedRequest } from '@/lib/auth/auth-api';

/**
 * Opt-in AI (Phase 9). Responses are schema-checked: the browser only renders
 * facts the backend computed and drafts the user must still confirm.
 */

const STATUS_KEY = ['ai', 'status'] as const;

export function useAiStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () =>
      (await authedRequest<AiStatusResponse>('/ai/status', { schema: aiStatusResponseSchema }))
        .data,
  });
}

function useStatusMutation<TVars>(fn: (vars: TVars) => Promise<AiStatusResponse>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => client.setQueryData(STATUS_KEY, status),
  });
}

export function useSetConsent() {
  return useStatusMutation(
    async ({ scope, granted }: { scope: AiConsentScope; granted: boolean }) =>
      (
        await authedRequest<AiStatusResponse>(`/ai/consents/${scope}`, {
          method: granted ? 'PUT' : 'DELETE',
          body: granted ? { policyVersion: AI_POLICY_VERSION } : undefined,
          schema: aiStatusResponseSchema,
        })
      ).data,
  );
}

export function useDeleteAiData() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await authedRequest<DeleteAiDataResponse>('/ai/data', { method: 'DELETE' })).data,
    onSuccess: () => client.invalidateQueries({ queryKey: ['ai'] }),
  });
}

/** Usage counters change with every provider call. */
function useRefreshStatus() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: STATUS_KEY });
}

export function useInsight() {
  const refresh = useRefreshStatus();
  return useMutation({
    mutationFn: async (body: InsightRequest) =>
      (
        await authedRequest<InsightResponse>('/ai/insights', {
          method: 'POST',
          body,
          schema: insightResponseSchema,
        })
      ).data,
    onSettled: refresh,
  });
}

export function useTextDraft() {
  const refresh = useRefreshStatus();
  return useMutation({
    mutationFn: async (body: TransactionDraftRequest) =>
      (
        await authedRequest<DraftResponse>('/ai/drafts/transaction', {
          method: 'POST',
          body,
          schema: draftResponseSchema,
        })
      ).data,
    onSettled: refresh,
  });
}

export function useReceiptDraft() {
  const refresh = useRefreshStatus();
  return useMutation({
    mutationFn: async ({ file, locale }: { file: File; locale: 'en' | 'bn' }) => {
      const form = new FormData();
      form.append('file', file);
      return (
        await authedRequest<DraftResponse>(`/ai/receipts/extract?locale=${locale}`, {
          method: 'POST',
          body: form,
          schema: draftResponseSchema,
        })
      ).data;
    },
    onSettled: refresh,
  });
}
