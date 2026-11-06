import { z } from 'zod';
import { accountTypeSchema, transactionResponseSchema } from './ledger';
import { currencyCodeSchema, isoDateSchema } from './money';
import {
  categoryTypeSchema,
  monthSchema,
  reminderResponseSchema,
  utilizationSchema,
} from './planning';

/**
 * Dashboard, reports and export (Phase 6). Every figure is computed by the API
 * from posted ledger data (DASH-01, REP-01); clients only format.
 * Report ranges are bounded (NFR performance).
 */

export const MAX_REPORT_MONTHS = 24;
export const MAX_REPORT_DAYS = 366;

const money = z.string();

// ───────────────────────────── Dashboard ─────────────────────────────

export const dashboardQuerySchema = z.strictObject({
  /** Defaults to the current month in the user's time zone. */
  month: monthSchema.optional(),
  /** Defaults to the user's default currency. */
  currency: currencyCodeSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const categoryTotalSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameBn: z.string(),
  parentId: z.string().nullable(),
  total: money,
  /** Share of the period total, two-decimal percent string. */
  share: z.string(),
});
export type CategoryTotal = z.infer<typeof categoryTotalSchema>;

export const dashboardResponseSchema = z.object({
  month: monthSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  currency: z.string(),
  /** Currencies the user holds besides `currency` (shown as a hint; never summed). */
  otherCurrencies: z.array(z.string()),
  /** Assets − liabilities across active and archived accounts in `currency` (all time). */
  netBalance: money,
  assets: money,
  liabilities: money,
  income: money,
  expense: money,
  netCashFlow: money,
  previous: z.object({ month: monthSchema, income: money, expense: money, netCashFlow: money }),
  topExpenseCategories: z.array(categoryTotalSchema),
  budget: z
    .object({
      id: z.string(),
      name: z.string(),
      overall: utilizationSchema.nullable(),
      itemsOver: z.number().int(),
      itemsWarning: z.number().int(),
    })
    .nullable(),
  goals: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      saved: money,
      targetAmount: money,
      percent: z.string(),
      status: z.enum(['ACTIVE', 'ACHIEVED', 'ARCHIVED']),
    }),
  ),
  recentTransactions: z.array(transactionResponseSchema),
  upcomingReminders: z.array(reminderResponseSchema),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

// ───────────────────────────── Cash flow ─────────────────────────────

export const cashFlowQuerySchema = z
  .strictObject({
    from: monthSchema,
    to: monthSchema,
    currency: currencyCodeSchema.optional(),
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: '`to` must not be before `from`' });
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;

export const cashFlowPointSchema = z.object({
  month: monthSchema,
  income: money,
  expense: money,
  net: money,
});
export type CashFlowPoint = z.infer<typeof cashFlowPointSchema>;

export const cashFlowResponseSchema = z.object({
  currency: z.string(),
  months: z.array(cashFlowPointSchema),
  totals: z.object({ income: money, expense: money, net: money }),
});
export type CashFlowResponse = z.infer<typeof cashFlowResponseSchema>;

// ───────────────────────────── Categories ─────────────────────────────

const dateRange = {
  from: isoDateSchema,
  to: isoDateSchema,
};

export const categoryReportQuerySchema = z
  .strictObject({
    ...dateRange,
    type: categoryTypeSchema.default('EXPENSE'),
    currency: currencyCodeSchema.optional(),
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: '`to` must not be before `from`' });
export type CategoryReportQuery = z.infer<typeof categoryReportQuerySchema>;

export const categoryReportResponseSchema = z.object({
  currency: z.string(),
  type: categoryTypeSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  total: money,
  categories: z.array(categoryTotalSchema),
});
export type CategoryReportResponse = z.infer<typeof categoryReportResponseSchema>;

// ───────────────────────────── Accounts ─────────────────────────────

export const accountReportQuerySchema = z
  .strictObject(dateRange)
  .refine((v) => v.from <= v.to, { path: ['to'], message: '`to` must not be before `from`' });
export type AccountReportQuery = z.infer<typeof accountReportQuerySchema>;

export const accountReportRowSchema = z.object({
  account: z.object({
    id: z.string(),
    name: z.string(),
    type: accountTypeSchema,
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  }),
  currency: z.string(),
  balanceType: z.enum(['ASSET', 'LIABILITY']),
  /** Natural-sign balance at the start of `from` (held for assets, owed for cards). */
  openingBalance: money,
  increase: money,
  decrease: money,
  closingBalance: money,
});
export type AccountReportRow = z.infer<typeof accountReportRowSchema>;

export const accountReportResponseSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  accounts: z.array(accountReportRowSchema),
});
export type AccountReportResponse = z.infer<typeof accountReportResponseSchema>;

// ───────────────────────────── Export ─────────────────────────────

export const exportQuerySchema = z
  .strictObject({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: '`to` must not be before `from`',
  });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const EXPORT_COLUMNS = [
  'date',
  'kind',
  'status',
  'account',
  'to_account',
  'category_en',
  'category_bn',
  'amount',
  'currency',
  'description',
  'occurred_at',
  'id',
] as const;
