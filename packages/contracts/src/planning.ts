import { z } from 'zod';
import { paginationQuerySchema } from './api/envelope';
import { accountTypeSchema } from './ledger';
import { currencyCodeSchema, DEFAULT_CURRENCY, isoDateSchema, moneyAmountSchema } from './money';

/** Categories, budgets, savings goals, reminders and notifications (Phase 5). */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const archiveFilter = z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE');

// ───────────────────────────── Categories ─────────────────────────────

export const categoryTypeSchema = z.enum(['INCOME', 'EXPENSE']);
export type CategoryType = z.infer<typeof categoryTypeSchema>;

export const listCategoriesQuerySchema = z.strictObject({
  type: categoryTypeSchema.optional(),
  status: archiveFilter,
});

export const createCategoryRequestSchema = z.strictObject({
  type: categoryTypeSchema,
  nameEn: text(1, 60),
  /** Defaults to the English name when omitted. */
  nameBn: text(1, 60).optional(),
  icon: text(1, 40).optional(),
  parentId: z.uuid().optional(),
});
export type CreateCategoryRequest = z.input<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .strictObject({
    nameEn: text(1, 60).optional(),
    nameBn: text(1, 60).optional(),
    icon: text(1, 40).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateCategoryRequest = z.input<typeof updateCategoryRequestSchema>;

export const categoryResponseSchema = z.object({
  id: z.string(),
  type: categoryTypeSchema,
  nameEn: z.string(),
  nameBn: z.string(),
  icon: z.string().nullable(),
  parentId: z.string().nullable(),
  isSystem: z.boolean(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
});
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;

// ───────────────────────────── Budgets ─────────────────────────────

/** Calendar month in the user's time zone, e.g. "2026-11". */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM');

export const budgetItemInputSchema = z.strictObject({
  categoryId: z.uuid(),
  amount: moneyAmountSchema,
});

const budgetItemsSchema = z
  .array(budgetItemInputSchema)
  .max(50)
  .refine((items) => new Set(items.map((i) => i.categoryId)).size === items.length, {
    message: 'Each category can appear only once',
  });

export const createBudgetRequestSchema = z
  .strictObject({
    month: monthSchema,
    name: text(1, 100).optional(),
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    overallAmount: moneyAmountSchema.optional(),
    items: budgetItemsSchema.default([]),
  })
  .refine((v) => v.overallAmount !== undefined || v.items.length > 0, {
    path: ['overallAmount'],
    message: 'Set an overall limit or at least one category limit',
  });
export type CreateBudgetRequest = z.input<typeof createBudgetRequestSchema>;

export const updateBudgetRequestSchema = z
  .strictObject({
    name: text(1, 100).optional(),
    overallAmount: moneyAmountSchema.nullable().optional(),
    /** Replaces the full set of category limits. */
    items: budgetItemsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateBudgetRequest = z.input<typeof updateBudgetRequestSchema>;

export const listBudgetsQuerySchema = z.strictObject({
  month: monthSchema.optional(),
  status: archiveFilter,
});

/** ok < 80% ≤ warning ≤ 100% < over. */
export const utilizationStatusSchema = z.enum(['ok', 'warning', 'over']);

export const utilizationSchema = z.object({
  limit: z.string(),
  spent: z.string(),
  /** Negative when overspent. */
  remaining: z.string(),
  /** Two-decimal percentage as a string, e.g. "82.50". */
  percentUsed: z.string(),
  status: utilizationStatusSchema,
});
export type Utilization = z.infer<typeof utilizationSchema>;

export const budgetResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  month: monthSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  currency: z.string(),
  archived: z.boolean(),
  /** All posted expenses in the period and currency (transfers and reversed entries excluded). */
  totalSpent: z.string(),
  overall: utilizationSchema.nullable(),
  items: z.array(
    utilizationSchema.extend({
      id: z.string(),
      category: z.object({ id: z.string(), nameEn: z.string(), nameBn: z.string() }),
    }),
  ),
});
export type BudgetResponse = z.infer<typeof budgetResponseSchema>;

// ─────────────────────────── Savings goals ───────────────────────────

export const goalStatusSchema = z.enum(['ACTIVE', 'ACHIEVED', 'ARCHIVED']);

export const createGoalRequestSchema = z.strictObject({
  name: text(1, 100),
  targetAmount: moneyAmountSchema,
  targetDate: isoDateSchema.optional(),
  /** Earmark model (ADR-009): money stays in this account; nothing is moved. */
  linkedAccountId: z.uuid(),
});
export type CreateGoalRequest = z.input<typeof createGoalRequestSchema>;

export const updateGoalRequestSchema = z
  .strictObject({
    name: text(1, 100).optional(),
    targetAmount: moneyAmountSchema.optional(),
    targetDate: isoDateSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateGoalRequest = z.input<typeof updateGoalRequestSchema>;

export const listGoalsQuerySchema = z.strictObject({
  status: z.enum(['ACTIVE', 'ACHIEVED', 'ARCHIVED', 'OPEN', 'ALL']).default('OPEN'),
});

export const createContributionRequestSchema = z.strictObject({
  kind: z.enum(['CONTRIBUTION', 'WITHDRAWAL']),
  amount: moneyAmountSchema,
  /** Defaults to today in the user's time zone; never in the future. */
  contributedOn: isoDateSchema.optional(),
  note: text(1, 255).optional(),
});
export type CreateContributionRequest = z.input<typeof createContributionRequestSchema>;

export const contributionResponseSchema = z.object({
  id: z.string(),
  kind: z.enum(['CONTRIBUTION', 'WITHDRAWAL', 'REVERSAL']),
  status: z.enum(['POSTED', 'REVERSED']),
  amount: z.string(),
  contributedOn: isoDateSchema,
  note: z.string().nullable(),
  reversesId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ContributionResponse = z.infer<typeof contributionResponseSchema>;

export const goalResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: goalStatusSchema,
  currency: z.string(),
  targetAmount: z.string(),
  targetDate: isoDateSchema.nullable(),
  /** Σ contributions − Σ withdrawals, excluding reversed entries. */
  saved: z.string(),
  remaining: z.string(),
  percent: z.string(),
  achievedAt: z.iso.datetime().nullable(),
  linkedAccount: z.object({
    id: z.string(),
    name: z.string(),
    type: accountTypeSchema,
    balance: z.string(),
    /** Σ saved across this account's open goals. */
    earmarked: z.string(),
  }),
  /** The account's balance fell below what is earmarked for its goals. */
  underFunded: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type GoalResponse = z.infer<typeof goalResponseSchema>;

export const goalDetailResponseSchema = goalResponseSchema.extend({
  contributions: z.array(contributionResponseSchema),
});
export type GoalDetailResponse = z.infer<typeof goalDetailResponseSchema>;

// ───────────────────────────── Reminders ─────────────────────────────

export const reminderStatusSchema = z.enum(['PENDING', 'DONE', 'CANCELLED']);

const dueAtSchema = z.iso.datetime({
  offset: true,
  message: 'Must be an ISO date-time with offset',
});

export const createReminderRequestSchema = z.strictObject({
  title: text(1, 120),
  notes: text(1, 1000).optional(),
  /** Absolute instant; stored in UTC (ADR-012). */
  dueAt: dueAtSchema,
});
export type CreateReminderRequest = z.input<typeof createReminderRequestSchema>;

export const updateReminderRequestSchema = z
  .strictObject({
    title: text(1, 120).optional(),
    notes: text(1, 1000).nullable().optional(),
    dueAt: dueAtSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateReminderRequest = z.input<typeof updateReminderRequestSchema>;

export const listRemindersQuerySchema = paginationQuerySchema
  .extend({
    view: z.enum(['upcoming', 'past_due', 'done', 'all']).default('upcoming'),
  })
  .strict();
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;

export const reminderResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  dueAt: z.iso.datetime(),
  /** The user's time zone when created, for display. */
  timezone: z.string(),
  /** Local calendar date of dueAt in that time zone. */
  dueDate: isoDateSchema,
  status: reminderStatusSchema,
  pastDue: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReminderResponse = z.infer<typeof reminderResponseSchema>;

// ─────────────────────────── Notifications ───────────────────────────

export const listNotificationsQuerySchema = paginationQuerySchema
  .extend({ unread: z.enum(['true', 'false']).optional() })
  .strict();
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationResponseSchema = z.object({
  id: z.string(),
  kind: z.enum(['REMINDER_DUE', 'BUDGET_THRESHOLD', 'GOAL_ACHIEVED', 'SECURITY', 'SYSTEM']),
  title: z.string(),
  body: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
