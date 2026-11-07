import { z } from 'zod';
import { paginationQuerySchema } from './api/envelope';
import {
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  isoDateSchema,
  moneyAmountOrZeroSchema,
  moneyAmountSchema,
} from './money';

/**
 * Accounts, transactions and transfers (Phase 4). Money is always a decimal
 * string (ADR-003); dates are ISO; request bodies are strict.
 */

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Account types a user creates directly via POST /accounts. */
export const EVERYDAY_ACCOUNT_TYPES = [
  'CASH',
  'BANK',
  'MOBILE_WALLET',
  'SAVINGS',
  'CREDIT_CARD_TRACKING',
  'OTHER',
] as const;
/** Phase 8: created only through /investments and /loans (ADR-022). */
export const WEALTH_ACCOUNT_TYPES = ['INVESTMENT', 'LOAN', 'LOAN_RECEIVABLE'] as const;
export const ACCOUNT_TYPES = [...EVERYDAY_ACCOUNT_TYPES, ...WEALTH_ACCOUNT_TYPES] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export type AccountType = z.infer<typeof accountTypeSchema>;
export const everydayAccountTypeSchema = z.enum(EVERYDAY_ACCOUNT_TYPES);

const nameSchema = z.string().trim().min(1, 'Enter a name').max(100);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const instantSchema = z.iso.datetime({
  offset: true,
  message: 'Must be an ISO date-time with offset',
});

// ───────────────────────────── Accounts ─────────────────────────────

export const createAccountRequestSchema = z
  .strictObject({
    name: nameSchema,
    type: everydayAccountTypeSchema,
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    openingDate: isoDateSchema,
    /** Asset accounts: money held. Credit cards: amount owed. Never negative. */
    openingBalance: moneyAmountOrZeroSchema.default('0'),
    institutionName: optionalText(100),
    creditLimit: moneyAmountSchema.optional(),
  })
  .refine((v) => v.creditLimit === undefined || v.type === 'CREDIT_CARD_TRACKING', {
    path: ['creditLimit'],
    message: 'Only credit-card accounts have a credit limit',
  });
export type CreateAccountRequest = z.input<typeof createAccountRequestSchema>;

/** Financial fields (type, currency, opening balance/date) are fixed after creation. */
export const updateAccountRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    institutionName: z.string().trim().max(100).nullable().optional(),
    creditLimit: moneyAmountSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateAccountRequest = z.input<typeof updateAccountRequestSchema>;

export const listAccountsQuerySchema = z.strictObject({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  /** EVERYDAY = cash/bank/wallet/savings/card/other; WEALTH = investments and loans. */
  group: z.enum(['EVERYDAY', 'WEALTH', 'ALL']).default('ALL'),
});

export const accountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  currency: z.string(),
  openingDate: isoDateSchema,
  openingBalance: z.string(),
  institutionName: z.string().nullable(),
  creditLimit: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  archivedAt: z.iso.datetime().nullable(),
  /**
   * Ledger-derived balance in the account's natural sign: money held for asset
   * accounts, amount OWED for credit cards (balanceType = LIABILITY).
   */
  balance: z.string(),
  balanceType: z.enum(['ASSET', 'LIABILITY']),
  createdAt: z.iso.datetime(),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;

// ─────────────────────────── Transactions ───────────────────────────

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE'] as const;
export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);
export const postingStatusSchema = z.enum(['POSTED', 'REVERSED']);

export const createTransactionRequestSchema = z.strictObject({
  type: transactionTypeSchema,
  accountId: z.uuid(),
  categoryId: z.uuid(),
  amount: moneyAmountSchema,
  currency: currencyCodeSchema,
  /** When it happened, with the user's offset, e.g. 2026-11-05T12:30:00+06:00. */
  occurredAt: instantSchema,
  description: optionalText(500),
});
export type CreateTransactionRequest = z.input<typeof createTransactionRequestSchema>;

export const reverseRequestSchema = z.strictObject({
  reason: optionalText(255),
});
export type ReverseRequest = z.input<typeof reverseRequestSchema>;

export const listTransactionsQuerySchema = paginationQuerySchema
  .extend({
    type: transactionTypeSchema.optional(),
    status: postingStatusSchema.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: '`to` must not be before `from`',
  });
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const transactionResponseSchema = z.object({
  id: z.string(),
  type: transactionTypeSchema,
  status: postingStatusSchema,
  amount: z.string(),
  currency: z.string(),
  occurredAt: z.iso.datetime(),
  effectiveDate: isoDateSchema,
  description: z.string().nullable(),
  account: z.object({ id: z.string(), name: z.string(), type: accountTypeSchema }),
  category: z.object({ id: z.string(), nameEn: z.string(), nameBn: z.string() }),
  reversedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;

/** Command responses include the ledger-derived balance after posting (blueprint §6.4). */
export const postedTransactionResponseSchema = transactionResponseSchema.extend({
  accountBalance: z.string(),
});
export type PostedTransactionResponse = z.infer<typeof postedTransactionResponseSchema>;

// ───────────────────────────── Transfers ─────────────────────────────

export const createTransferRequestSchema = z
  .strictObject({
    sourceAccountId: z.uuid(),
    destinationAccountId: z.uuid(),
    amount: moneyAmountSchema,
    currency: currencyCodeSchema,
    occurredAt: instantSchema,
    description: optionalText(500),
  })
  .refine((v) => v.sourceAccountId !== v.destinationAccountId, {
    path: ['destinationAccountId'],
    message: 'Choose two different accounts',
  });
export type CreateTransferRequest = z.input<typeof createTransferRequestSchema>;

export const listTransfersQuerySchema = paginationQuerySchema
  .extend({
    accountId: z.uuid().optional(),
    status: postingStatusSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;

const accountRefSchema = z.object({ id: z.string(), name: z.string(), type: accountTypeSchema });

export const transferResponseSchema = z.object({
  id: z.string(),
  status: postingStatusSchema,
  amount: z.string(),
  currency: z.string(),
  occurredAt: z.iso.datetime(),
  effectiveDate: isoDateSchema,
  description: z.string().nullable(),
  sourceAccount: accountRefSchema,
  destinationAccount: accountRefSchema,
  reversedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type TransferResponse = z.infer<typeof transferResponseSchema>;
