# Categories, Budgets, Goals, Reminders & Notifications

> Phase 5 · 2026-11-05 · Decisions: ADR-009 (earmark goals), ADR-012 (dates), ADR-014 (background jobs). All endpoints live under `/api/v1` and require a bearer token.

## Categories (CAT-01)

| Method | Path                                                            | Notes                                                                                                         |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/categories?type=INCOME\|EXPENSE&status=ACTIVE\|ARCHIVED\|ALL` | The seeded bilingual system categories plus **only your own**                                                 |
| POST   | `/categories`                                                   | `type`, `nameEn`, optional `nameBn` (defaults to `nameEn`), `icon`, `parentId` (top-level, same type)         |
| PATCH  | `/categories/:id`                                               | Your own only. System categories return 403                                                                   |
| POST   | `/categories/:id/archive`, `/restore`                           | Never deleted, because history references them. Archived categories reject new transactions and budget limits |

Rules:

- At most two levels deep.
- Active custom names are unique per type (case-insensitive), otherwise 409.
- Another user's category returns 404.

## Budgets (BUD-01, BUD-02)

| Method      | Path                               | Notes                                                                                                                |
| ----------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET         | `/budgets?month=YYYY-MM&status=…`  | Each budget comes with live utilization                                                                              |
| POST        | `/budgets`                         | `month`, optional `name`, `currency` (BDT), `overallAmount`, `items[{categoryId, amount}]`. Needs at least one limit |
| GET / PATCH | `/budgets/:id`                     | PATCH `items` **replaces** the whole set                                                                             |
| POST        | `/budgets/:id/archive`, `/restore` | Only one active budget per month and currency (DB partial unique index), otherwise 409                               |

**How utilization is computed:**

- **Spent** is the sum of `transactions` where `type = EXPENSE`, `status = POSTED` and `currency` matches the budget, with `effectiveDate` between the first and last day of the month.
  - Effective dates are already local to the user's time zone. For example, `2026-10-31T18:30Z` counts in **November** in Asia/Dhaka.
  - Transfers are never transactions, so they are excluded.
  - Reversed expenses have status `REVERSED`, so they are excluded.
  - The result reconciles with the ledger: Σ EXPENSE journal lines for the period, including reversal journals dated like the original, gives the same total. This is tested.
- **Category tree:** a limit on a parent category covers its sub-categories. A "Utilities" limit includes electricity, gas and water.
- **Overall:** all expenses in the period and currency, whether or not they are budgeted.
- **Per limit**, the response returns:
  - `limit`, `spent`
  - `remaining` (negative when overspent)
  - `percentUsed` (a two-decimal string)
  - `status`: `ok` below 80%, `warning` from 80% to 100%, `over` above 100%. The status uses the exact ratio, so 79.9999% is still `ok`.

## Savings goals: earmark model (GOAL-01, GOAL-02, ADR-009)

| Method      | Path                                                  | Notes                                                                                                                                                     |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET         | `/goals?status=OPEN\|ACTIVE\|ACHIEVED\|ARCHIVED\|ALL` | `OPEN` = ACTIVE + ACHIEVED                                                                                                                                |
| POST        | `/goals`                                              | `name`, `targetAmount`, optional `targetDate`, `linkedAccountId` (an active, non-card account). The goal currency is the account's currency               |
| GET / PATCH | `/goals/:id`                                          | The detail view includes the contribution history. PATCH covers `name`, `targetAmount` and `targetDate` only. **There is no way to set the saved amount** |
| POST        | `/goals/:id/archive`                                  | Releases the goal's earmark and keeps its history                                                                                                         |
| POST        | `/goals/:id/contributions`                            | **Idempotency-Key required.** `kind`: `CONTRIBUTION` (set aside) or `WITHDRAWAL` (release), plus `amount`, `contributedOn` (≤ today) and `note`           |
| POST        | `/goals/:id/contributions/:cid/reverse`               | **Idempotency-Key required.** Appends a `REVERSAL` row and marks the original `REVERSED`                                                                  |

**Rules:**

- **No money moves.** No journal is posted, and the account balance is unchanged. The UI says so on the page.
- **Saved amount:** Σ CONTRIBUTION − Σ WITHDRAWAL over entries that are still POSTED. A reversed entry and its reversal row are both excluded.
- **Earmark cap:** a contribution must fit within the account's _unallocated_ money, i.e. the ledger balance minus the saved amounts of all open goals on that account. Otherwise the API returns 409 with the available amount.
  - The account row is locked (`SELECT … FOR UPDATE`), so concurrent contributions cannot both pass the cap. This is tested.
- **Withdrawals** are limited to the goal's saved amount, otherwise 400.
- **Status:** `ACTIVE` ⇄ `ACHIEVED` follows the history automatically. Reaching the target creates one `GOAL_ACHIEVED` notification.
- **Under-funding:** `underFunded: true` means the account's balance later fell below what its goals have set aside. The API only warns and makes no automatic changes.
- **Append-only:** contribution rows are never edited or deleted, and database triggers enforce this.

## Reminders (REM-01)

| Method      | Path                                                          | Notes                                                                                     |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET         | `/reminders?view=upcoming\|past_due\|done\|all&page&pageSize` |                                                                                           |
| POST        | `/reminders`                                                  | `title`, `dueAt` (ISO instant with offset, must be in the future), `notes`                |
| GET / PATCH | `/reminders/:id`                                              | Only `PENDING` reminders can be changed. Rescheduling makes the reminder notifiable again |
| POST        | `/reminders/:id/complete`, `/cancel`                          | Repeating the same action is a no-op. Changing a closed reminder returns 409              |

- `dueAt` is stored in UTC.
- Each reminder also keeps the user's time zone at creation, so the response can include its local `dueDate`.
- The MVP has one-time reminders only. `recurrenceRule` is reserved.

## Notifications

`GET /notifications?unread=true|false`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`.

Notifications are in-app only for now, with kinds `REMINDER_DUE` and `GOAL_ACHIEVED`.

## Background jobs (ADR-014)

The jobs run on BullMQ with Redis, inside the API process, when `WORKER_ENABLED=true` and `REDIS_URL` is set.

| Job                   | Every | What it does                                                                                                                                                                  |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reminders.dispatch`  | 60 s  | Claims due, un-notified, pending reminders with `FOR UPDATE SKIP LOCKED`, creates a notification for each and sets `notified_at`. **Exactly once**, even with several workers |
| `idempotency.cleanup` | 1 h   | Deletes idempotency keys older than 24 h                                                                                                                                      |

- Redis only schedules the jobs. PostgreSQL is the source of truth, and every handler is idempotent.
- `JOBS_PREFIX` keeps environments that share a Redis apart.
- `/health/ready` reports Redis as `up`, `down` (HTTP 200, `status: degraded`, API still serving) or `disabled`.

**Not yet:** the outbox publisher. Outbox rows are written, but no consumer needs them yet. Budget-threshold alerts (v1.1) will be the first consumer. Email or push delivery of reminders will come with notification preferences.
