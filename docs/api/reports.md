# Dashboard, Reports & Export

> Phase 6 · 2026-11-06 · Requirements: DASH-01, REP-01, EXP-01. All endpoints live under `/api/v1` and require a bearer token. Every figure is computed by the API, and the web app only formats it.

## Data rules

- **Income/expense** is the sum of `transactions` with `status = POSTED`, grouped by `effective_date`, which is a local date in the user's time zone.
  - Transfers are never transactions, so they are excluded.
  - Reversed entries are `REVERSED`, so they are excluded.
  - Each total is checked against the INCOME/EXPENSE ledger journal lines, which include reversal journals dated like the original.
- **Balances** come from journal lines (ADR-004). Credit cards are liabilities: what you owe.
- **Currency:** totals are per currency and never mixed (ADR-016). The default is the user's `defaultCurrency`, and other currencies are listed in `otherCurrencies`.
- **Bounds:** cash flow covers at most 24 months, and category and account reports at most 366 days.

## Endpoints

| Method | Path                    | Query                                                        | Returns                                                                                                                                                                                                                                          |
| ------ | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/dashboard/overview`   | `month?` (YYYY-MM, default current local month), `currency?` | `netBalance` (assets − liabilities, current), `assets`, `liabilities`, `income`, `expense`, `netCashFlow`, the `previous` month, `topExpenseCategories` (top 5), budget summary, open goals (3), recent transactions (5), upcoming reminders (3) |
| GET    | `/reports/cash-flow`    | `from`, `to` (YYYY-MM), `currency?`                          | one point per month (`income`, `expense`, `net`), months without activity included, plus `totals`                                                                                                                                                |
| GET    | `/reports/categories`   | `from`, `to` (dates), `type` (EXPENSE), `currency?`          | categories ranked by `total` with `share` (2-dp percent) and the period `total`                                                                                                                                                                  |
| GET    | `/reports/accounts`     | `from`, `to` (dates)                                         | per account: `openingBalance` (before `from`), `increase`, `decrease`, `closingBalance` (natural sign)                                                                                                                                           |
| GET    | `/exports/transactions` | `from?`, `to?` (dates)                                       | **CSV download** (not enveloped)                                                                                                                                                                                                                 |

## CSV export

- Columns: `date, kind, status, account, to_account, category_en, category_bn, amount, currency, description, occurred_at, id`.
- `kind` is `INCOME`, `EXPENSE` or `TRANSFER`. Reversed rows are included with `status = REVERSED`, so the export is a complete history.
- **Formula injection:** a cell starting with `= + - @`, a tab or a CR is prefixed with `'`. Every cell is quoted, embedded quotes are doubled, and lines end with CRLF.
- The file starts with a UTF-8 BOM so Excel shows Bangla correctly. Headers: `Content-Disposition: attachment`, `Cache-Control: no-store`.
- Rows are streamed in batches of 1,000.
- The endpoint is limited to 10 requests per minute and every export is audited (`export.transactions`, with the row count only).

## Tests

- `test/reports/reports-flow.int-spec.ts` covers:
  - Exact figures for a realistic Sep–Nov dataset, including a reversed expense, a transfer, a card payment and a USD expense.
  - **Month-by-month reconciliation** with ledger journal lines.
  - Account report closing balances equal to the live account balances.
  - The dashboard computed from the same data.
  - CSV escaping, BOM, filtering and isolation between users.
- `apps/web/e2e/full-flow.spec.ts` (Playwright) runs the blueprint flow through the UI: register → verify → log out/in → accounts → income → expense → transfer → budget → goal → dashboard (checks `৳59,550.00`) → reports → CSV download.
- `apps/web/e2e/mobile.spec.ts` checks the bottom navigation and switching to Bangla.
