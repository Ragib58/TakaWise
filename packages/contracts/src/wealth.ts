import { z } from 'zod';
import { accountTypeSchema } from './ledger';
import {
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  isoDateSchema,
  moneyAmountOrZeroSchema,
  moneyAmountSchema,
} from './money';

/**
 * Investments, loans, net-worth items and net worth (Phase 8, ADR-022/023).
 *
 * Every figure the user types (rates, maturity values, valuations) is their
 * own; TakaWise never fetches or invents rates, prices or returns. Values are
 * labelled with how they were obtained (`basis`).
 */

const nameSchema = z.string().trim().min(1, 'Enter a name').max(100);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const instantSchema = z.iso.datetime({
  offset: true,
  message: 'Must be an ISO date-time with offset',
});

/** Annual rate in percent, 0–100 with up to 4 decimals, as a string (e.g. "9.5"). */
export const percentSchema = z
  .string()
  .trim()
  .regex(/^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/, 'Enter a rate between 0 and 100');

/** Units held (shares, grams…): positive, up to 8 decimals. */
export const quantitySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/, 'Enter a quantity')
  .refine((v) => !/^0(?:\.0+)?$/.test(v), 'Must be greater than 0');

/** Where a value came from. RECORDED = the ledger balance (what was actually moved). */
export const VALUE_BASES = ['RECORDED', 'USER_ENTERED', 'ESTIMATED', 'VERIFIED'] as const;
export const valueBasisSchema = z.enum(VALUE_BASES);
export type ValueBasis = z.infer<typeof valueBasisSchema>;

/** Sources a user may choose. VERIFIED needs a connected data source, which does not exist yet. */
export const VALUATION_INPUT_SOURCES = ['USER_ENTERED', 'ESTIMATED'] as const;

// ───────────────────────────── Valuations ─────────────────────────────

export const createValuationRequestSchema = z.strictObject({
  value: moneyAmountOrZeroSchema,
  valuedOn: isoDateSchema,
  source: z.enum(VALUATION_INPUT_SOURCES).default('USER_ENTERED'),
  note: optionalText(255),
});
export type CreateValuationRequest = z.input<typeof createValuationRequestSchema>;

export const valuationResponseSchema = z.object({
  id: z.string(),
  value: z.string(),
  currency: z.string(),
  valuedOn: isoDateSchema,
  source: valueBasisSchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ValuationResponse = z.infer<typeof valuationResponseSchema>;

// ───────────────────────────── Investments ─────────────────────────────

export const INVESTMENT_KINDS = [
  'DPS',
  'FDR',
  'SAVINGS_CERTIFICATE',
  'BOND',
  'STOCK',
  'MUTUAL_FUND',
  'GOLD',
  'OTHER',
] as const;
export const investmentKindSchema = z.enum(INVESTMENT_KINDS);
export type InvestmentKind = z.infer<typeof investmentKindSchema>;

export const createInvestmentRequestSchema = z
  .strictObject({
    name: nameSchema,
    kind: investmentKindSchema,
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    openingDate: isoDateSchema,
    /** Amount invested so far (cost), as of the opening date. */
    initialAmount: moneyAmountOrZeroSchema.default('0'),
    /**
     * Where the initial amount came from. Set it when the money left one of your
     * accounts (recorded as a transfer, so it is not counted twice). Leave it out
     * for an investment you already held (recorded as an opening balance).
     */
    fundingAccountId: z.uuid().optional(),
    institutionName: optionalText(100),
    maturityDate: isoDateSchema.optional(),
    interestRate: percentSchema.optional(),
    expectedMaturityValue: moneyAmountSchema.optional(),
    quantity: quantitySchema.optional(),
    quantityUnit: optionalText(20),
    notes: optionalText(500),
  })
  .refine((v) => !v.fundingAccountId || !/^0(?:\.0+)?$/.test(v.initialAmount ?? '0'), {
    path: ['initialAmount'],
    message: 'Enter the amount moved from the funding account',
  })
  .refine((v) => !v.maturityDate || v.maturityDate >= v.openingDate, {
    path: ['maturityDate'],
    message: 'Maturity cannot be before the opening date',
  })
  .refine((v) => !v.quantityUnit || v.quantity !== undefined, {
    path: ['quantity'],
    message: 'Enter the quantity for this unit',
  });
export type CreateInvestmentRequest = z.input<typeof createInvestmentRequestSchema>;

export const updateInvestmentRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    institutionName: nullableText(100),
    maturityDate: isoDateSchema.nullable().optional(),
    interestRate: percentSchema.nullable().optional(),
    expectedMaturityValue: moneyAmountSchema.nullable().optional(),
    quantity: quantitySchema.nullable().optional(),
    quantityUnit: nullableText(20),
    notes: nullableText(500),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateInvestmentRequest = z.input<typeof updateInvestmentRequestSchema>;

export const listWealthQuerySchema = z.strictObject({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
});

export const investmentResponseSchema = z.object({
  /** Same id as the underlying INVESTMENT account (use it with /transfers and /transactions). */
  id: z.string(),
  name: z.string(),
  kind: investmentKindSchema,
  currency: z.string(),
  institutionName: z.string().nullable(),
  openingDate: isoDateSchema,
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  archivedAt: z.iso.datetime().nullable(),
  maturityDate: isoDateSchema.nullable(),
  /** User-entered assumption (% per year). */
  interestRate: z.string().nullable(),
  /** User-entered estimate. */
  expectedMaturityValue: z.string().nullable(),
  quantity: z.string().nullable(),
  quantityUnit: z.string().nullable(),
  notes: z.string().nullable(),
  /** Ledger balance: money moved in, minus money taken out, plus recorded returns. */
  recordedValue: z.string(),
  /** Latest valuation rolled forward by later movements, or the recorded value. */
  currentValue: z.string(),
  valueBasis: valueBasisSchema,
  valuedOn: isoDateSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type InvestmentResponse = z.infer<typeof investmentResponseSchema>;

export const investmentDetailResponseSchema = investmentResponseSchema.extend({
  valuations: z.array(valuationResponseSchema),
});
export type InvestmentDetailResponse = z.infer<typeof investmentDetailResponseSchema>;

// ─────────────────────────────── Loans ───────────────────────────────

export const LOAN_DIRECTIONS = ['BORROWED', 'LENT'] as const;
export const loanDirectionSchema = z.enum(LOAN_DIRECTIONS);
export type LoanDirection = z.infer<typeof loanDirectionSchema>;

const termMonthsSchema = z.number().int().min(1).max(600);

export const createLoanRequestSchema = z
  .strictObject({
    direction: loanDirectionSchema,
    name: nameSchema,
    /** Lender (borrowed) or borrower (lent). */
    counterparty: optionalText(100),
    institutionName: optionalText(100),
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    openingDate: isoDateSchema,
    /** Original loan amount. */
    principal: moneyAmountSchema,
    /**
     * For a loan that already exists: what is still owed on the opening date
     * (defaults to the principal). Not allowed with `disbursementAccountId`.
     */
    outstandingBalance: moneyAmountOrZeroSchema.optional(),
    /**
     * For a new loan: the account the money went into (borrowed) or came out of
     * (lent). The principal is recorded as a transfer on the opening date.
     */
    disbursementAccountId: z.uuid().optional(),
    interestRate: percentSchema.optional(),
    termMonths: termMonthsSchema.optional(),
    firstPaymentDate: isoDateSchema.optional(),
    notes: optionalText(500),
  })
  .refine((v) => !(v.disbursementAccountId && v.outstandingBalance !== undefined), {
    path: ['outstandingBalance'],
    message: 'A new loan starts at its principal; leave this empty',
  })
  .refine((v) => (v.termMonths === undefined) === (v.firstPaymentDate === undefined), {
    path: ['firstPaymentDate'],
    message: 'Enter both the term and the first payment date, or neither',
  });
export type CreateLoanRequest = z.input<typeof createLoanRequestSchema>;

export const updateLoanRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    counterparty: nullableText(100),
    institutionName: nullableText(100),
    interestRate: percentSchema.nullable().optional(),
    termMonths: termMonthsSchema.nullable().optional(),
    firstPaymentDate: isoDateSchema.nullable().optional(),
    notes: nullableText(500),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateLoanRequest = z.input<typeof updateLoanRequestSchema>;

export const createLoanPaymentRequestSchema = z
  .strictObject({
    /** Pay from this account (borrowed) or receive into it (lent). */
    accountId: z.uuid(),
    occurredAt: instantSchema,
    principal: moneyAmountOrZeroSchema.default('0'),
    interest: moneyAmountOrZeroSchema.default('0'),
    /** Defaults to "Loan interest" (borrowed) or "Profit & interest" (lent). */
    interestCategoryId: z.uuid().optional(),
    description: optionalText(500),
  })
  .refine(
    (v) => !/^0(?:\.0+)?$/.test(v.principal ?? '0') || !/^0(?:\.0+)?$/.test(v.interest ?? '0'),
    { path: ['principal'], message: 'Enter a principal or an interest amount' },
  );
export type CreateLoanPaymentRequest = z.input<typeof createLoanPaymentRequestSchema>;

const accountRefSchema = z.object({ id: z.string(), name: z.string(), type: accountTypeSchema });

export const loanPaymentResponseSchema = z.object({
  id: z.string(),
  principal: z.string(),
  interest: z.string(),
  total: z.string(),
  currency: z.string(),
  paidOn: isoDateSchema,
  status: z.enum(['POSTED', 'REVERSED']),
  reversedAt: z.iso.datetime().nullable(),
  /** The account the payment was made from / received into. */
  account: accountRefSchema,
  transferId: z.string().nullable(),
  transactionId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type LoanPaymentResponse = z.infer<typeof loanPaymentResponseSchema>;

export const instalmentSchema = z.object({
  number: z.number().int(),
  dueDate: isoDateSchema,
  payment: z.string(),
  principal: z.string(),
  interest: z.string(),
  balance: z.string(),
});
export type Instalment = z.infer<typeof instalmentSchema>;

export const loanResponseSchema = z.object({
  /** Same id as the underlying LOAN / LOAN_RECEIVABLE account. */
  id: z.string(),
  name: z.string(),
  direction: loanDirectionSchema,
  counterparty: z.string().nullable(),
  institutionName: z.string().nullable(),
  currency: z.string(),
  openingDate: isoDateSchema,
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  archivedAt: z.iso.datetime().nullable(),
  principal: z.string(),
  interestRate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  firstPaymentDate: isoDateSchema.nullable(),
  notes: z.string().nullable(),
  /** Ledger balance of the loan account: what is owed now (to you, if lent). */
  outstanding: z.string(),
  principalRepaid: z.string(),
  interestPaid: z.string(),
  /** Estimated monthly instalment (EMI) from the terms entered, if any. */
  instalment: z.string().nullable(),
  nextDueDate: isoDateSchema.nullable(),
  /** Estimate for the next payment from the outstanding amount; editable by the user. */
  suggestedPayment: z.object({ principal: z.string(), interest: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type LoanResponse = z.infer<typeof loanResponseSchema>;

export const loanDetailResponseSchema = loanResponseSchema.extend({
  /** Estimated amortization schedule (empty without term/first payment date). */
  schedule: z.array(instalmentSchema),
  payments: z.array(loanPaymentResponseSchema),
});
export type LoanDetailResponse = z.infer<typeof loanDetailResponseSchema>;

// ─────────────────────────── Net-worth items ───────────────────────────

export const NET_WORTH_ASSET_KINDS = [
  'REAL_ESTATE',
  'VEHICLE',
  'JEWELLERY',
  'BUSINESS',
  'OTHER_ASSET',
] as const;
export const NET_WORTH_LIABILITY_KINDS = ['PERSONAL_DEBT', 'OTHER_LIABILITY'] as const;
export const NET_WORTH_ITEM_KINDS = [
  ...NET_WORTH_ASSET_KINDS,
  ...NET_WORTH_LIABILITY_KINDS,
] as const;
export const netWorthItemKindSchema = z.enum(NET_WORTH_ITEM_KINDS);
export type NetWorthItemKind = z.infer<typeof netWorthItemKindSchema>;
export const netWorthSideSchema = z.enum(['ASSET', 'LIABILITY']);

export function sideForItemKind(kind: NetWorthItemKind): 'ASSET' | 'LIABILITY' {
  return (NET_WORTH_ASSET_KINDS as readonly string[]).includes(kind) ? 'ASSET' : 'LIABILITY';
}

export const createNetWorthItemRequestSchema = z.strictObject({
  name: nameSchema,
  kind: netWorthItemKindSchema,
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  /** Current value (asset) or amount owed (liability). */
  value: moneyAmountOrZeroSchema,
  valuedOn: isoDateSchema,
  source: z.enum(VALUATION_INPUT_SOURCES).default('USER_ENTERED'),
  notes: optionalText(500),
});
export type CreateNetWorthItemRequest = z.input<typeof createNetWorthItemRequestSchema>;

export const updateNetWorthItemRequestSchema = z
  .strictObject({ name: nameSchema.optional(), notes: nullableText(500) })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field');
export type UpdateNetWorthItemRequest = z.input<typeof updateNetWorthItemRequestSchema>;

export const netWorthItemResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  side: netWorthSideSchema,
  kind: netWorthItemKindSchema,
  currency: z.string(),
  notes: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  archivedAt: z.iso.datetime().nullable(),
  /** Latest valuation (null only if every valuation was deleted). */
  value: z.string().nullable(),
  valuedOn: isoDateSchema.nullable(),
  valueBasis: valueBasisSchema.nullable(),
  valuations: z.array(valuationResponseSchema),
  createdAt: z.iso.datetime(),
});
export type NetWorthItemResponse = z.infer<typeof netWorthItemResponseSchema>;

// ───────────────────────────── Net worth ─────────────────────────────

export const NET_WORTH_GROUPS = [
  'CASH_AND_ACCOUNTS',
  'INVESTMENTS',
  'MONEY_LENT',
  'OTHER_ASSETS',
  'CREDIT_CARDS',
  'LOANS',
  'OTHER_LIABILITIES',
] as const;
export const netWorthGroupSchema = z.enum(NET_WORTH_GROUPS);
export type NetWorthGroup = z.infer<typeof netWorthGroupSchema>;

export const netWorthQuerySchema = z.strictObject({
  /** Defaults to today in the user's time zone. */
  asOf: isoDateSchema.optional(),
});

export const netWorthHistoryQuerySchema = z.strictObject({
  months: z.coerce.number().int().min(2).max(24).default(12),
});

export const netWorthLineSchema = z.object({
  source: z.enum(['ACCOUNT', 'ITEM']),
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema.nullable(),
  group: netWorthGroupSchema,
  side: netWorthSideSchema,
  value: z.string(),
  recorded: z.string().nullable(),
  basis: valueBasisSchema,
  valuedOn: isoDateSchema.nullable(),
});
export type NetWorthLine = z.infer<typeof netWorthLineSchema>;

export const netWorthCurrencySchema = z.object({
  currency: z.string(),
  assets: z.string(),
  liabilities: z.string(),
  netWorth: z.string(),
  groups: z.array(
    z.object({ group: netWorthGroupSchema, side: netWorthSideSchema, total: z.string() }),
  ),
  lines: z.array(netWorthLineSchema),
});
export type NetWorthCurrency = z.infer<typeof netWorthCurrencySchema>;

export const netWorthResponseSchema = z.object({
  asOf: isoDateSchema,
  /** One entry per currency; never summed across currencies (ADR-016). */
  currencies: z.array(netWorthCurrencySchema),
});
export type NetWorthResponse = z.infer<typeof netWorthResponseSchema>;

export const netWorthHistoryResponseSchema = z.object({
  dates: z.array(isoDateSchema),
  series: z.array(
    z.object({
      currency: z.string(),
      points: z.array(
        z.object({
          date: isoDateSchema,
          assets: z.string(),
          liabilities: z.string(),
          netWorth: z.string(),
        }),
      ),
    }),
  ),
});
export type NetWorthHistoryResponse = z.infer<typeof netWorthHistoryResponseSchema>;
