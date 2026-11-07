-- Phase 8 (ADR-022): new account types for investments and loans.
-- Kept in its own migration: PostgreSQL cannot use a newly added enum value
-- inside the transaction that added it, and later migrations reference them.

ALTER TYPE "FinancialAccountType" ADD VALUE 'INVESTMENT';
ALTER TYPE "FinancialAccountType" ADD VALUE 'LOAN';
ALTER TYPE "FinancialAccountType" ADD VALUE 'LOAN_RECEIVABLE';
