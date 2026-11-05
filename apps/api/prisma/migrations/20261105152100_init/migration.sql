-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'BN');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('CASH', 'BANK', 'MOBILE_WALLET', 'SAVINGS', 'CREDIT_CARD_TRACKING', 'OTHER');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LedgerAccountClass" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerSystemCode" AS ENUM ('EQUITY_OPENING_BALANCE', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER', 'REVERSAL');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('POSTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GoalEntryKind" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REMINDER_DUE', 'BUDGET_THRESHOLD', 'GOAL_ACHIEVED', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('RECEIPT', 'AVATAR', 'EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'DELETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Dhaka',
    "default_currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "avatar_file_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(60),
    "replaced_by_id" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "opening_date" DATE NOT NULL,
    "opening_balance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "institution_name" VARCHAR(100),
    "credit_limit" DECIMAL(20,4),
    "status" "ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account_templates" (
    "code" "LedgerSystemCode" NOT NULL,
    "class" "LedgerAccountClass" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "name_bn" VARCHAR(120) NOT NULL,

    CONSTRAINT "ledger_account_templates_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "financial_account_id" UUID,
    "system_code" "LedgerSystemCode",
    "class" "LedgerAccountClass" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
    "effective_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "memo" VARCHAR(255),
    "reverses_id" UUID,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "debit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "account_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "effective_date" DATE NOT NULL,
    "description" VARCHAR(500),
    "reversal_journal_entry_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "source_account_id" UUID NOT NULL,
    "destination_account_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "effective_date" DATE NOT NULL,
    "description" VARCHAR(500),
    "reversal_journal_entry_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "user_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "parent_id" UUID,
    "type" "CategoryType" NOT NULL,
    "name_en" VARCHAR(60) NOT NULL,
    "name_bn" VARCHAR(60) NOT NULL,
    "icon" VARCHAR(40),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_key" VARCHAR(60),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "overall_amount" DECIMAL(20,4),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_items" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "target_amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "target_date" DATE,
    "linked_account_id" UUID NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "achieved_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "GoalEntryKind" NOT NULL,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "amount" DECIMAL(20,4) NOT NULL,
    "contributed_on" DATE NOT NULL,
    "note" VARCHAR(255),
    "reverses_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "notes" VARCHAR(1000),
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "recurrence_rule" VARCHAR(255),
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ(3),
    "notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000),
    "payload" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(127) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "checksum_sha256" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(60),
    "entity_id" UUID,
    "request_id" VARCHAR(128),
    "ip_hash" CHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_replaced_by_id_key" ON "sessions"("replaced_by_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_purpose_created_at_idx" ON "verification_tokens"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "financial_accounts_user_id_status_idx" ON "financial_accounts"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_id_user_id_key" ON "financial_accounts"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_financial_account_id_key" ON "ledger_accounts"("financial_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_id_user_id_key" ON "ledger_accounts"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_user_id_system_code_key" ON "ledger_accounts"("user_id", "system_code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_financial_account_id_user_id_key" ON "ledger_accounts"("financial_account_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_id_key" ON "journal_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "journal_entries_user_id_effective_date_idx" ON "journal_entries"("user_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_id_user_id_key" ON "journal_entries"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_id_user_id_key" ON "journal_entries"("reverses_id", "user_id");

-- CreateIndex
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_ledger_account_id_idx" ON "journal_lines"("ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_journal_entry_id_key" ON "transactions"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reversal_journal_entry_id_key" ON "transactions"("reversal_journal_entry_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_effective_date_idx" ON "transactions"("user_id", "effective_date");

-- CreateIndex
CREATE INDEX "transactions_user_id_type_effective_date_idx" ON "transactions"("user_id", "type", "effective_date");

-- CreateIndex
CREATE INDEX "transactions_user_id_account_id_effective_date_idx" ON "transactions"("user_id", "account_id", "effective_date");

-- CreateIndex
CREATE INDEX "transactions_user_id_category_id_effective_date_idx" ON "transactions"("user_id", "category_id", "effective_date");

-- CreateIndex
CREATE INDEX "transactions_user_id_status_idx" ON "transactions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_journal_entry_id_user_id_key" ON "transactions"("journal_entry_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reversal_journal_entry_id_user_id_key" ON "transactions"("reversal_journal_entry_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_journal_entry_id_key" ON "transfers"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reversal_journal_entry_id_key" ON "transfers"("reversal_journal_entry_id");

-- CreateIndex
CREATE INDEX "transfers_user_id_effective_date_idx" ON "transfers"("user_id", "effective_date");

-- CreateIndex
CREATE INDEX "transfers_user_id_source_account_id_idx" ON "transfers"("user_id", "source_account_id");

-- CreateIndex
CREATE INDEX "transfers_user_id_destination_account_id_idx" ON "transfers"("user_id", "destination_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_journal_entry_id_user_id_key" ON "transfers"("journal_entry_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reversal_journal_entry_id_user_id_key" ON "transfers"("reversal_journal_entry_id", "user_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_system_key_key" ON "categories"("system_key");

-- CreateIndex
CREATE INDEX "categories_user_id_type_status_idx" ON "categories"("user_id", "type", "status");

-- CreateIndex
CREATE INDEX "budgets_user_id_start_date_idx" ON "budgets"("user_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_id_user_id_key" ON "budgets"("id", "user_id");

-- CreateIndex
CREATE INDEX "budget_items_category_id_idx" ON "budget_items"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_items_budget_id_category_id_key" ON "budget_items"("budget_id", "category_id");

-- CreateIndex
CREATE INDEX "savings_goals_user_id_status_idx" ON "savings_goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "savings_goals_linked_account_id_idx" ON "savings_goals"("linked_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "savings_goals_id_user_id_key" ON "savings_goals"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_contributions_reverses_id_key" ON "goal_contributions"("reverses_id");

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_contributed_on_idx" ON "goal_contributions"("goal_id", "contributed_on");

-- CreateIndex
CREATE INDEX "goal_contributions_user_id_idx" ON "goal_contributions"("user_id");

-- CreateIndex
CREATE INDEX "reminders_user_id_status_due_at_idx" ON "reminders"("user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "reminders_status_due_at_idx" ON "reminders"("status", "due_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_created_at_idx" ON "outbox_events"("processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "files_object_key_key" ON "files"("object_key");

-- CreateIndex
CREATE INDEX "files_user_id_purpose_idx" ON "files"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_financial_account_id_user_id_fkey" FOREIGN KEY ("financial_account_id", "user_id") REFERENCES "financial_accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_id_user_id_fkey" FOREIGN KEY ("reverses_id", "user_id") REFERENCES "journal_entries"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_journal_entry_id_user_id_fkey" FOREIGN KEY ("journal_entry_id", "user_id") REFERENCES "journal_entries"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reversal_journal_entry_id_user_id_fkey" FOREIGN KEY ("reversal_journal_entry_id", "user_id") REFERENCES "journal_entries"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_user_id_fkey" FOREIGN KEY ("account_id", "user_id") REFERENCES "financial_accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_journal_entry_id_user_id_fkey" FOREIGN KEY ("journal_entry_id", "user_id") REFERENCES "journal_entries"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_reversal_journal_entry_id_user_id_fkey" FOREIGN KEY ("reversal_journal_entry_id", "user_id") REFERENCES "journal_entries"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_account_id_user_id_fkey" FOREIGN KEY ("source_account_id", "user_id") REFERENCES "financial_accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_account_id_user_id_fkey" FOREIGN KEY ("destination_account_id", "user_id") REFERENCES "financial_accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_linked_account_id_user_id_fkey" FOREIGN KEY ("linked_account_id", "user_id") REFERENCES "financial_accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_user_id_fkey" FOREIGN KEY ("goal_id", "user_id") REFERENCES "savings_goals"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "goal_contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
