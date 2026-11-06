-- Phase 7: read-path indexes chosen from load-test measurements (docs/ops/load-test.md).

-- Ledger balances (ADR-004) sum all lines of an account on every read.
-- A covering index lets PostgreSQL answer SUM(debit), SUM(credit) with an
-- index-only scan instead of visiting the table.
CREATE INDEX "journal_lines_ledger_account_amounts_idx"
  ON "journal_lines" ("ledger_account_id") INCLUDE ("debit", "credit");

-- Budgets, dashboard and category/cash-flow reports aggregate posted
-- transactions by user, type and effective date: cover every column they read.
CREATE INDEX "transactions_reporting_idx"
  ON "transactions" ("user_id", "type", "effective_date")
  INCLUDE ("status", "currency", "category_id", "amount");

-- Description search (`q`) uses ILIKE '%term%'; trigram GIN makes it indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "transactions_description_trgm_idx"
  ON "transactions" USING gin ("description" gin_trgm_ops);
