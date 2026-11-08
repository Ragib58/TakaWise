import { type PlanEntitlements, planEntitlementsSchema } from '@takawise/contracts';

/**
 * Entitlement rules (Phase 10, ADR-025). Pure functions; the API is the only
 * place they are enforced.
 */

export const FREE_PLAN = 'FREE';

/** Statuses that grant access while the period has not ended. */
export const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

export type SubscriptionLike = {
  status: string;
  currentPeriodEnd: Date;
};

/** A subscription grants its plan only while live and inside its paid period. */
export function isSubscriptionEffective(sub: SubscriptionLike, now: Date): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(sub.status) && sub.currentPeriodEnd > now;
}

/** Parses stored JSON; a corrupt plan fails closed to nothing extra. */
export function parseEntitlements(raw: unknown): PlanEntitlements {
  const parsed = planEntitlementsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return {
    maxAccounts: 1,
    aiInsights: false,
    aiDrafts: false,
    receiptOcr: false,
    familyWorkspace: false,
    maxFamilyMembers: 2,
  };
}

const maxNullable = (a: number | null, b: number | null) =>
  a === null || b === null ? null : a > b ? a : b;

/**
 * A family member is covered by the owner's family plan: every feature the
 * cover grants is added, but cover never lets the member own a workspace.
 */
export function withFamilyCover(
  own: PlanEntitlements,
  cover: PlanEntitlements | null,
): PlanEntitlements {
  if (!cover) return own;
  return {
    maxAccounts: maxNullable(own.maxAccounts, cover.maxAccounts),
    aiInsights: own.aiInsights || cover.aiInsights,
    aiDrafts: own.aiDrafts || cover.aiDrafts,
    receiptOcr: own.receiptOcr || cover.receiptOcr,
    familyWorkspace: own.familyWorkspace,
    maxFamilyMembers: own.maxFamilyMembers,
  };
}

/** True when another account may be created under `maxAccounts`. */
export function canAddAccount(entitlements: PlanEntitlements, activeAccounts: number): boolean {
  return entitlements.maxAccounts === null || activeAccounts < entitlements.maxAccounts;
}

/** Period end for a new or renewed subscription (calendar months, clamped to month end). */
export function addMonthsUtc(from: Date, months: number): Date {
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = from.getUTCDate() < lastDay ? from.getUTCDate() : lastDay;
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
    ),
  );
}
