import { z } from 'zod';
import { moneyAmountOrZeroSchema } from './money';

/**
 * Phase 10: subscriptions and entitlements (ADR-025), family workspaces
 * (ADR-026), support and admin (ADR-027). Entitlements are always enforced by
 * the API; the web only uses them to explain what a plan includes.
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

// ─────────────────────────────── Plans & entitlements ───────────────────────────────

export const PLAN_CODES = ['FREE', 'PRO', 'FAMILY'] as const;
export const planCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use A–Z, 0–9 and _');

export const planEntitlementsSchema = z.strictObject({
  /** Active everyday accounts (cash, bank, wallet…); null = unlimited. */
  maxAccounts: z.number().int().min(1).max(10_000).nullable(),
  aiInsights: z.boolean(),
  aiDrafts: z.boolean(),
  receiptOcr: z.boolean(),
  /** May create (own) a family workspace. */
  familyWorkspace: z.boolean(),
  /** Including the owner. */
  maxFamilyMembers: z.number().int().min(2).max(20),
});
export type PlanEntitlements = z.infer<typeof planEntitlementsSchema>;

/** Names used in PLAN_REQUIRED errors and in the UI. */
export const ENTITLEMENT_FEATURES = [
  'accounts',
  'aiInsights',
  'aiDrafts',
  'receiptOcr',
  'familyWorkspace',
  'familyMembers',
] as const;
export type EntitlementFeature = (typeof ENTITLEMENT_FEATURES)[number];

export const planResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  priceAmount: z.string(),
  currency: z.string(),
  interval: z.enum(['MONTH', 'YEAR']),
  active: z.boolean(),
  entitlements: planEntitlementsSchema,
});
export type PlanResponse = z.infer<typeof planResponseSchema>;

export const subscriptionStatusSchema = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
]);

export const subscriptionResponseSchema = z.object({
  id: z.string(),
  planCode: z.string(),
  status: subscriptionStatusSchema,
  provider: z.string(),
  currentPeriodEnd: z.iso.datetime(),
  cancelAtPeriodEnd: z.boolean(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const billingStatusResponseSchema = z.object({
  /** Plan whose entitlements apply right now (FREE without a live subscription). */
  plan: planResponseSchema,
  subscription: subscriptionResponseSchema.nullable(),
  /** Effective entitlements, including cover from a family plan. */
  entitlements: planEntitlementsSchema,
  /** Name of the family workspace whose plan covers this user, if any. */
  coveredBy: z.string().nullable(),
  usage: z.object({ accounts: z.number().int() }),
  /** Purchasable plans (active, priced). */
  plans: z.array(planResponseSchema),
  /** `none` until a payment provider is configured; `fake` in development. */
  provider: z.string(),
  checkoutEnabled: z.boolean(),
});
export type BillingStatusResponse = z.infer<typeof billingStatusResponseSchema>;

export const checkoutRequestSchema = z.strictObject({ planCode: planCodeSchema });
export type CheckoutRequest = z.input<typeof checkoutRequestSchema>;

export const checkoutResponseSchema = z.object({
  checkoutId: z.string(),
  /** Where to send the browser (the provider's hosted page). */
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

/** Provider-neutral webhook event (after signature verification). */
export const PAYMENT_EVENT_TYPES = [
  'checkout.completed',
  'subscription.renewed',
  'subscription.canceled',
  'payment.failed',
] as const;
export const paymentEventSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  data: z
    .object({
      checkoutId: z.string().optional(),
      subscriptionId: z.string().max(120).optional(),
      currentPeriodEnd: z.iso.datetime().optional(),
    })
    .passthrough(),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

// ─────────────────────────────── Feature flags ───────────────────────────────

export const FEATURE_FLAG_KEYS = [
  'billing.checkout',
  'family.workspaces',
  'support.tickets',
  'ai.assistant',
] as const;
export const featureFlagKeySchema = z.enum(FEATURE_FLAG_KEYS);
export type FeatureFlagKey = z.infer<typeof featureFlagKeySchema>;

export const featureFlagsResponseSchema = z.record(z.string(), z.boolean());

// ─────────────────────────────── Family ───────────────────────────────

export const familyRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type FamilyRole = z.infer<typeof familyRoleSchema>;
export const shareResourceTypeSchema = z.enum(['ACCOUNT', 'BUDGET', 'GOAL']);
export type ShareResourceType = z.infer<typeof shareResourceTypeSchema>;

export const createWorkspaceRequestSchema = z.strictObject({ name: text(1, 80) });
export const renameWorkspaceRequestSchema = createWorkspaceRequestSchema;

export const inviteMemberRequestSchema = z.strictObject({
  email: z.email().trim().toLowerCase().max(254),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});
export type InviteMemberRequest = z.input<typeof inviteMemberRequestSchema>;

export const acceptInvitationRequestSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{10}$/, 'Enter the 10-character code from the e-mail'),
});

export const changeMemberRoleRequestSchema = z.strictObject({ role: z.enum(['ADMIN', 'MEMBER']) });

export const createShareRequestSchema = z.strictObject({
  resourceType: shareResourceTypeSchema,
  resourceId: z.uuid(),
});
export type CreateShareRequest = z.input<typeof createShareRequestSchema>;

export const familyMemberResponseSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: familyRoleSchema,
  joinedAt: z.iso.datetime(),
});

export const familyInvitationResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: familyRoleSchema,
  expiresAt: z.iso.datetime(),
});

export const familyShareResponseSchema = z.object({
  id: z.string(),
  resourceType: shareResourceTypeSchema,
  resourceId: z.string(),
  sharedBy: z.object({ userId: z.string(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type FamilyShareResponse = z.infer<typeof familyShareResponseSchema>;

export const workspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  myRole: familyRoleSchema,
  memberCount: z.number().int(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const workspaceDetailSchema = workspaceSummarySchema.extend({
  ownerId: z.string(),
  maxMembers: z.number().int(),
  members: z.array(familyMemberResponseSchema),
  /** Only visible to the owner and admins. */
  invitations: z.array(familyInvitationResponseSchema),
  shares: z.array(familyShareResponseSchema),
});
export type WorkspaceDetail = z.infer<typeof workspaceDetailSchema>;

/** Read-only view of a shared resource; computed live at request time. */
export const sharedResourceSchema = z.discriminatedUnion('resourceType', [
  z.object({
    resourceType: z.literal('ACCOUNT'),
    shareId: z.string(),
    sharedBy: z.string(),
    name: z.string(),
    accountType: z.string(),
    currency: z.string(),
    balance: z.string(),
  }),
  z.object({
    resourceType: z.literal('BUDGET'),
    shareId: z.string(),
    sharedBy: z.string(),
    name: z.string(),
    month: z.string(),
    currency: z.string(),
    limit: z.string().nullable(),
    spent: z.string(),
    percentUsed: z.string().nullable(),
  }),
  z.object({
    resourceType: z.literal('GOAL'),
    shareId: z.string(),
    sharedBy: z.string(),
    name: z.string(),
    currency: z.string(),
    targetAmount: z.string(),
    saved: z.string(),
    percent: z.string(),
    targetDate: z.string().nullable(),
  }),
]);
export type SharedResource = z.infer<typeof sharedResourceSchema>;

// ─────────────────────────────── Support ───────────────────────────────

export const TICKET_CATEGORIES = ['ACCOUNT', 'BILLING', 'BUG', 'FEATURE', 'OTHER'] as const;
export const TICKET_STATUSES = ['OPEN', 'PENDING_USER', 'RESOLVED', 'CLOSED'] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);

export const createTicketRequestSchema = z.strictObject({
  subject: text(3, 150),
  category: z.enum(TICKET_CATEGORIES),
  body: text(1, 4000),
});
export type CreateTicketRequest = z.input<typeof createTicketRequestSchema>;

export const ticketMessageRequestSchema = z.strictObject({ body: text(1, 4000) });

export const ticketMessageResponseSchema = z.object({
  id: z.string(),
  fromStaff: z.boolean(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});

export const ticketResponseSchema = z.object({
  id: z.string(),
  subject: z.string(),
  category: z.enum(TICKET_CATEGORIES),
  status: ticketStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: z.array(ticketMessageResponseSchema),
});
export type TicketResponse = z.infer<typeof ticketResponseSchema>;

// ─────────────────────────────── Admin ───────────────────────────────

export const platformRoleSchema = z.enum(['NONE', 'SUPPORT', 'ADMIN']);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

export const updatePlanRequestSchema = z
  .strictObject({
    name: text(1, 60).optional(),
    priceAmount: moneyAmountOrZeroSchema.optional(),
    interval: z.enum(['MONTH', 'YEAR']).optional(),
    active: z.boolean().optional(),
    entitlements: planEntitlementsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdatePlanRequest = z.input<typeof updatePlanRequestSchema>;

export const grantSubscriptionRequestSchema = z.strictObject({
  planCode: planCodeSchema,
  months: z.number().int().min(1).max(24),
  note: text(1, 200).optional(),
});
export type GrantSubscriptionRequest = z.input<typeof grantSubscriptionRequestSchema>;

export const setRoleRequestSchema = z.strictObject({ role: platformRoleSchema });

export const updateFlagRequestSchema = z.strictObject({ enabled: z.boolean() });

export const updateTicketRequestSchema = z.strictObject({ status: ticketStatusSchema });

/** Limited account metadata for staff: never balances, transactions or notes. */
export const adminUserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.string(),
  emailVerified: z.boolean(),
  platformRole: platformRoleSchema,
  createdAt: z.iso.datetime(),
  subscription: subscriptionResponseSchema.nullable(),
});
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;

export const adminTicketResponseSchema = ticketResponseSchema.extend({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
});
export type AdminTicketResponse = z.infer<typeof adminTicketResponseSchema>;

export const adminSubscriptionRowSchema = subscriptionResponseSchema.extend({
  user: z.object({ id: z.string(), email: z.string() }),
  createdAt: z.iso.datetime(),
});

/** Aggregate counts only. */
export const adminAnalyticsResponseSchema = z.object({
  generatedAt: z.iso.datetime(),
  users: z.object({
    total: z.number().int(),
    active: z.number().int(),
    verified: z.number().int(),
    newLast30Days: z.number().int(),
    signedInLast30Days: z.number().int(),
  }),
  subscriptions: z.array(z.object({ planCode: z.string(), live: z.number().int() })),
  family: z.object({ workspaces: z.number().int(), activeMembers: z.number().int() }),
  ai: z.array(z.object({ feature: z.string(), status: z.string(), requests: z.number().int() })),
  tickets: z.array(z.object({ status: z.string(), count: z.number().int() })),
});
export type AdminAnalyticsResponse = z.infer<typeof adminAnalyticsResponseSchema>;

export const adminMeResponseSchema = z.object({ role: platformRoleSchema });
