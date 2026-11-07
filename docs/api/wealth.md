# API — Investments, Loans and Net Worth (Phase 8)

> Decisions: [ADR-022](../architecture/decisions.md#adr-022--investments-and-loans-are-ledger-accounts-phase-8-2026-11-07) (ledger model) and [ADR-023](../architecture/decisions.md#adr-023--valuations-and-net-worth-phase-8-2026-11-07) (valuations, net worth). Tables: [erd.md](../architecture/erd.md).

## Principles

- **Your figures only.** Rates, maturity values, schedules and valuations come from what the user types. TakaWise never fetches prices or rates, never invents returns, and gives no investment advice. Every value carries a **basis**:
  - `RECORDED`: the ledger balance, meaning the money actually moved in or out.
  - `USER_ENTERED` or `ESTIMATED`: the user's own valuation.
  - `VERIFIED`: reserved. The database rejects it until a real data source is connected.
- **No double counting.**
  - An investment or loan is an account in the ledger, so moving money into it is a **transfer**: no new money appears, and nothing is income or spending.
  - Net worth counts each account once. For an investment, the latest valuation **replaces** the ledger balance; it is never added to it.
  - Net-worth items are only things that are _not_ accounts.
- Money is a decimal string. Totals are per currency and are never mixed (ADR-016).
- Every route requires authentication. Another user's resource returns **404**.

## Investments

The investment `id` is also its **account id**:

- Add money: `POST /transfers` from an everyday account to the investment.
- Withdraw: `POST /transfers` from the investment to an everyday account.
- Record profit or interest: `POST /transactions` of type `INCOME` on the investment, with category `income.profit_interest`. It then appears in the income reports.

| Method | Path                                        | Notes                                                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/investments?status=ACTIVE\|ARCHIVED\|ALL` | List with `recordedValue`, `currentValue`, `valueBasis`, `valuedOn`                                                                                                                                                                                                                        |
| POST   | `/investments`                              | **Idempotency-Key** required. `kind` is one of DPS, FDR, SAVINGS_CERTIFICATE, BOND, STOCK, MUTUAL_FUND, GOLD, OTHER. `initialAmount` + `fundingAccountId` posts a transfer from that account. Without `fundingAccountId`, the amount is an opening balance (for an investment held before) |
| GET    | `/investments/:id`                          | Detail plus `valuations[]` (newest first)                                                                                                                                                                                                                                                  |
| PATCH  | `/investments/:id`                          | name, institution, maturity date, rate, expected value, quantity/unit, notes. Financial history cannot be edited                                                                                                                                                                           |
| POST   | `/investments/:id/archive` · `/restore`     |                                                                                                                                                                                                                                                                                            |
| POST   | `/investments/:id/valuations`               | `{ value, valuedOn, source: USER_ENTERED\|ESTIMATED, note? }`. Not in the future and not before opening. One per date (409)                                                                                                                                                                |
| DELETE | `/investments/:id/valuations/:valuationId`  | To correct a valuation, delete it and enter it again                                                                                                                                                                                                                                       |

**Current value** is the latest valuation on or before today **plus** money moved in or out since that valuation date. A top-up after a valuation is therefore counted once.

## Loans

A loan is a `LOAN` account (money you borrowed, a liability) or a `LOAN_RECEIVABLE` account (money you lent, an asset). The **outstanding amount is always the ledger balance** of that account.

| Method | Path                                     | Notes                                                                                                                       |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/loans?status=`                         | List with `outstanding`, `principalRepaid`, `interestPaid`, `instalment`, `nextDueDate`, `suggestedPayment`                 |
| POST   | `/loans`                                 | **Idempotency-Key** required. Two ways to create one (see below). `termMonths` and `firstPaymentDate` must be sent together |
| GET    | `/loans/:id`                             | Detail plus the estimated `schedule[]` and `payments[]`                                                                     |
| PATCH  | `/loans/:id`                             | name, counterparty, institution, rate, term/first payment (both or neither), notes                                          |
| POST   | `/loans/:id/archive` · `/restore`        |                                                                                                                             |
| POST   | `/loans/:id/payments`                    | **Idempotency-Key** required. See below                                                                                     |
| POST   | `/loans/:id/payments/:paymentId/reverse` | **Idempotency-Key** required. Reverses both postings of the payment                                                         |

Creating a loan:

- **New loan:** send `disbursementAccountId`. The principal moves through that account on the opening date. A borrowed loan pays into it; a lent loan pays out of it. Net worth does not change.
- **Existing loan:** send `outstandingBalance`, which defaults to the principal. It becomes the opening balance.

Recording a payment, `POST /loans/:id/payments`, takes `{ accountId, occurredAt, principal, interest, interestCategoryId?, description? }`:

- **Principal** becomes a transfer between `accountId` and the loan. It is excluded from spending and income.
- **Interest** becomes an `EXPENSE` from `accountId` for a borrowed loan (category `expense.loan_interest`), or an `INCOME` into `accountId` for a lent loan (category `income.profit_interest`).
- Both postings and the `loan_payments` row commit **atomically**. The principal cannot exceed what is outstanding (400).
- The transfer and transaction inside a payment **cannot be reversed on their own**: `/transfers/:id/reverse` and `/transactions/:id/reverse` return **409**. Use the payment reversal instead.

**Schedule (estimate).** The schedule uses a reducing-balance EMI with monthly compounding. Instalments are rounded to paisa (half-up), and the last instalment absorbs the rounding.

- `suggestedPayment` is one month of interest on the _actual_ outstanding amount; the rest of the instalment is principal. It is a pre-fill only.
- `nextDueDate` is the first instalment after the latest payment.
- The lender's statement is authoritative.

## Net worth

| Method        | Path                                             | Notes                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET           | `/net-worth?asOf=YYYY-MM-DD`                     | Defaults to today in the user's time zone; a future date returns 400. Per currency: `assets`, `liabilities`, `netWorth`, `groups[]` and `lines[]` (each with `basis`, `valuedOn`, and `recorded` for accounts) |
| GET           | `/net-worth/history?months=2..24`                | Month-end points, the last one being today, per currency                                                                                                                                                       |
| GET           | `/net-worth/items?status=`                       | Net-worth items with their valuations                                                                                                                                                                          |
| POST          | `/net-worth/items`                               | `{ name, kind, currency?, value, valuedOn, source?, notes? }`. The kind sets the side: REAL_ESTATE, VEHICLE, JEWELLERY, BUSINESS and OTHER_ASSET are assets; PERSONAL_DEBT and OTHER_LIABILITY are liabilities |
| GET · PATCH   | `/net-worth/items/:id`                           | PATCH accepts name and notes                                                                                                                                                                                   |
| POST          | `/net-worth/items/:id/archive` · `/restore`      | Archive means sold or settled: the item is not counted from that date on                                                                                                                                       |
| POST · DELETE | `/net-worth/items/:id/valuations[/:valuationId]` | The last remaining valuation cannot be deleted (409); archive the item instead                                                                                                                                 |

The groups are `CASH_AND_ACCOUNTS`, `INVESTMENTS`, `MONEY_LENT`, `OTHER_ASSETS`, `CREDIT_CARDS`, `LOANS` and `OTHER_LIABILITIES`.

**Net worth is computed when it is read** from the ledger, the valuations and the items. No snapshots are stored, so history can never drift from the ledger.

## Accounts API changes

- `ACCOUNT_TYPES` now include `INVESTMENT`, `LOAN` and `LOAN_RECEIVABLE`. `POST /accounts` accepts only the everyday types (the investment and loan types return 400).
- `GET /accounts?group=EVERYDAY|WEALTH|ALL` filters the list. The default is `ALL`.
- `balanceType` is `LIABILITY` for credit cards and borrowed loans.
- The dashboard `netBalance` stays the **ledger** figure across all accounts, so it includes loans and investments at their recorded value. The Net worth page adds valuations and items on top.
