import type { PlanEntitlements } from '@takawise/contracts';

/**
 * Phase 10 defaults (ADR-025). Seeded ONCE (create-only): admins own these
 * rows afterwards, so a deploy never overwrites their changes.
 *
 * PRO and FAMILY start inactive at price 0: prices are a business decision,
 * and nothing can be bought until an admin sets a price and activates a plan.
 */
export const DEFAULT_PLANS: Array<{
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  entitlements: PlanEntitlements;
}> = [
  {
    code: 'FREE',
    name: 'Free',
    active: true,
    sortOrder: 0,
    entitlements: {
      maxAccounts: 10,
      aiInsights: true,
      aiDrafts: true,
      receiptOcr: false,
      familyWorkspace: false,
      maxFamilyMembers: 2,
    },
  },
  {
    code: 'PRO',
    name: 'Pro',
    active: false,
    sortOrder: 10,
    entitlements: {
      maxAccounts: null,
      aiInsights: true,
      aiDrafts: true,
      receiptOcr: true,
      familyWorkspace: false,
      maxFamilyMembers: 2,
    },
  },
  {
    code: 'FAMILY',
    name: 'Family',
    active: false,
    sortOrder: 20,
    entitlements: {
      maxAccounts: null,
      aiInsights: true,
      aiDrafts: true,
      receiptOcr: true,
      familyWorkspace: true,
      maxFamilyMembers: 6,
    },
  },
];

export const DEFAULT_FLAGS: Array<{ key: string; enabled: boolean; description: string }> = [
  { key: 'billing.checkout', enabled: true, description: 'Users can start a checkout' },
  { key: 'family.workspaces', enabled: true, description: 'Family workspaces and sharing' },
  { key: 'support.tickets', enabled: true, description: 'Users can open support tickets' },
  {
    key: 'ai.assistant',
    enabled: true,
    description: 'AI assistant kill switch (on top of AI_ENABLED)',
  },
];
