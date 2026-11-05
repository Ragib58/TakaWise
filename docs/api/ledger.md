# Ledger, Accounts, Transactions & Transfers

> Phase 4 · 2026-11-05 · Decisions: ADR-003 (money), ADR-004 (ledger is the source of truth), ADR-005 (balanced journals), ADR-006 (idempotency), ADR-007 (chart of accounts), ADR-008 (credit cards), ADR-010 (reversals), ADR-012 (dates), ADR-016 (currency). Schema: [erd.md](../architecture/erd.md).

## How a posting works

```
POST /transactions  (Authorization: Bearer …, Idempotency-Key: <uuid>)
 └─ JwtAuthGuard → Zod (strict body) → TransactionsService.create
     └─ IdempotencyService.execute  ── one DB transaction ───────────────────────────────┐
         1. replay check: same key + same request → stored response (nothing written)     │
         2. load the account WHERE id AND user_id (else 404); must be ACTIVE, same currency│
         3. category: system or own, ACTIVE, matching type                                │
         4. effective date = local date of occurredAt in the user's time zone;            │
            not in the future, not before the account's opening date                      │
         5. LedgerService.post: pure template → validateJournalLines → insert journal+lines│
         6. insert transaction row, audit log, outbox event                               │
         7. insert idempotency key with the response                                      │
     COMMIT ── deferred trigger re-checks Σdebit = Σcredit, currency, ownership ──────────┘
 └─ 201 { data: { …transaction, accountBalance } }
```

Any failure rolls back **everything**: the journal, the transaction row, the audit and outbox rows, and the idempotency key.

## Normal-balance rules

| Ledger class                               | Normal | Balance                            |
| ------------------------------------------ | ------ | ---------------------------------- |
| ASSET (cash, bank, wallet, savings, other) | DEBIT  | Σdebit − Σcredit = money held      |
| LIABILITY (credit card)                    | CREDIT | Σcredit − Σdebit = amount **owed** |
| EQUITY (opening balance)                   | CREDIT | Σcredit − Σdebit                   |
| INCOME                                     | CREDIT | Σcredit − Σdebit                   |
| EXPENSE                                    | DEBIT  | Σdebit − Σcredit                   |

`balance` in account responses uses that natural sign, and `balanceType` (`ASSET` / `LIABILITY`) tells the UI whether to label the figure "Balance" or "Owed". These rules are defined once in `domain/ledger/ledger-rules.ts`, mirrored by database CHECKs, and covered by unit tests.

## Posting templates

| Event                                 | Debit                                                                      | Credit         |
| ------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| Opening balance, asset                | Account                                                                    | Opening equity |
| Opening balance, card (owed)          | Opening equity                                                             | Card           |
| Income into account                   | Account                                                                    | Income         |
| Expense from account                  | Expense                                                                    | Account        |
| Transfer A → B                        | B                                                                          | A              |
| Card bill paid from bank (a transfer) | Card                                                                       | Bank           |
| Reversal                              | every original line with debit and credit swapped, **same effective date** |                |

A transfer never touches Income or Expense, so it is excluded from income/expense totals automatically (TRX-03). Paying a card bill is a transfer, so it is never counted as a second expense.

## Endpoints (`/api/v1`, all require a bearer token)

| Method      | Path                                             | Idempotency-Key | Notes                                                                                                                      |
| ----------- | ------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET         | `/accounts?status=ACTIVE\|ARCHIVED\|ALL`         |                 | With ledger balances                                                                                                       |
| POST        | `/accounts`                                      | required        | `openingBalance` ≥ 0 (cards: amount owed). `openingDate` not in the future. `creditLimit` only on cards                    |
| GET / PATCH | `/accounts/:id`                                  |                 | PATCH: `name`, `institutionName`, `creditLimit` only. Type, currency and opening values are fixed                          |
| POST        | `/accounts/:id/archive`, `/accounts/:id/restore` |                 | An archived account keeps its history and balance but accepts no new postings                                              |
| GET         | `/transactions`                                  |                 | `page`, `pageSize` (≤ 100), `type`, `status`, `accountId`, `categoryId`, `from`, `to` (effective dates), `q` (description) |
| POST        | `/transactions`                                  | required        | INCOME or EXPENSE. Returns `accountBalance`                                                                                |
| GET         | `/transactions/:id`                              |                 |                                                                                                                            |
| POST        | `/transactions/:id/reverse`                      | required        | Optional `reason`. A second attempt returns 409                                                                            |
| GET / POST  | `/transfers`                                     | POST required   | Distinct accounts, one currency                                                                                            |
| GET         | `/transfers/:id`                                 |                 |                                                                                                                            |
| POST        | `/transfers/:id/reverse`                         | required        |                                                                                                                            |

## Idempotency

- The header is `Idempotency-Key: <uuid>`, and it is required on every financial command above. A missing or invalid key returns 400.
- A key is scoped to the user and the command (`POST /transactions`, `POST /transactions/:id/reverse`, …) and is kept for 24 h.
- Sending the same key and body again returns the original response with the `Idempotent-Replayed: true` header, and nothing is written.
- Sending the same key with a different body returns 422 `IDEMPOTENCY_MISMATCH`.
- Concurrent duplicates: exactly one commits, and the others return its response. This is tested with five parallel requests.
- A request that fails (400/404/409) stores no key, so the client may retry with the same key after fixing the input.

## Errors

| Situation                                                                                    | Status / code                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Account, transaction, transfer or category of another user (or missing)                      | 404 `NOT_FOUND`                               |
| Archived account or category, already reversed                                               | 409 `CONFLICT`                                |
| Duplicate active account name                                                                | 409 `CONFLICT` (field `name`)                 |
| Wrong currency, wrong category type, future date, date before opening, same-account transfer | 400 `VALIDATION_ERROR` with `details[].field` |

## Deliberate MVP limits

- There is no FX, and every total is per currency (ADR-016).
- No balance cache: balances are summed from journal lines on read (indexed). A rebuildable projection will be added only if measurements need one (ADR-004).
- The opening balance or opening date cannot be corrected after creation. Record an adjustment transaction or transfer instead, or archive the account and create a new one.
- Outbox events (`account.created`, `transaction.posted|reversed`, `transfer.posted|reversed`) are written now and consumed starting in Phase 5.
- There is no UI yet. Account and transaction screens arrive in Phase 6.
