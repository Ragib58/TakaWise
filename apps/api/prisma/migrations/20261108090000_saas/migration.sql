-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('NONE', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "FamilyMemberStatus" AS ENUM ('ACTIVE', 'REMOVED', 'LEFT');

-- CreateEnum
CREATE TYPE "ShareResourceType" AS ENUM ('ACCOUNT', 'BUDGET', 'GOAL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ACCOUNT', 'BILLING', 'BUG', 'FEATURE', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "platform_role" "PlatformRole" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "plans" (
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "price_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "entitlements" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_code" VARCHAR(20) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "provider_subscription_id" VARCHAR(120),
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "ended_at" TIMESTAMPTZ(3),
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_checkouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_code" VARCHAR(20) NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" VARCHAR(150) NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "from_staff" BOOLEAN NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_workspaces" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "family_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "status" "FamilyMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("workspace_id","user_id")
);

-- CreateTable
CREATE TABLE "family_invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_shares" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource_type" "ShareResourceType" NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "family_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_provider_subscription_id_key" ON "subscriptions"("provider", "provider_subscription_id");

-- CreateIndex
CREATE INDEX "billing_checkouts_user_id_created_at_idx" ON "billing_checkouts"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_updated_at_idx" ON "support_tickets"("status", "updated_at");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "family_members_user_id_status_idx" ON "family_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "family_invitations_code_hash_key" ON "family_invitations"("code_hash");

-- CreateIndex
CREATE INDEX "family_invitations_workspace_id_idx" ON "family_invitations"("workspace_id");

-- CreateIndex
CREATE INDEX "family_shares_workspace_id_idx" ON "family_shares"("workspace_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_workspaces" ADD CONSTRAINT "family_workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "family_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invitations" ADD CONSTRAINT "family_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "family_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_shares" ADD CONSTRAINT "family_shares_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "family_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_shares" ADD CONSTRAINT "family_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Phase 10 rules (ADR-025/026/027) ───
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  ADD CONSTRAINT "plans_price_non_negative" CHECK ("price_amount" >= 0),
  ADD CONSTRAINT "plans_entitlements_object" CHECK (jsonb_typeof("entitlements") = 'object');

-- At most one live subscription per user.
CREATE UNIQUE INDEX "subscriptions_one_live_per_user"
  ON "subscriptions" ("user_id") WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_ended_consistent"
  CHECK (("status" IN ('CANCELED', 'EXPIRED')) = ("ended_at" IS NOT NULL));

ALTER TABLE "billing_checkouts"
  ADD CONSTRAINT "billing_checkouts_amount_non_negative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "billing_checkouts_completed_consistent"
  CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_subject_not_blank" CHECK (length(btrim("subject")) > 0);
ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_body_not_blank" CHECK (length(btrim("body")) > 0);

-- Exactly one owner per workspace; ended memberships carry ended_at.
CREATE UNIQUE INDEX "family_members_one_owner" ON "family_members" ("workspace_id") WHERE "role" = 'OWNER';
ALTER TABLE "family_members"
  ADD CONSTRAINT "family_members_ended_consistent"
  CHECK (("status" = 'ACTIVE') = ("ended_at" IS NULL));

ALTER TABLE "family_invitations"
  ADD CONSTRAINT "family_invitations_email_normalized" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "family_invitations_role_not_owner" CHECK ("role" <> 'OWNER');
CREATE UNIQUE INDEX "family_invitations_one_pending"
  ON "family_invitations" ("workspace_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

CREATE UNIQUE INDEX "family_shares_one_active"
  ON "family_shares" ("workspace_id", "resource_type", "resource_id") WHERE "revoked_at" IS NULL;

-- A member can only share a resource they own (polymorphic, so a trigger not an FK).
CREATE OR REPLACE FUNCTION tw_family_shares_owner() RETURNS trigger AS $$
DECLARE
  owner uuid;
BEGIN
  IF NEW."resource_type" = 'ACCOUNT' THEN
    SELECT "user_id" INTO owner FROM "financial_accounts" WHERE "id" = NEW."resource_id";
  ELSIF NEW."resource_type" = 'BUDGET' THEN
    SELECT "user_id" INTO owner FROM "budgets" WHERE "id" = NEW."resource_id";
  ELSE
    SELECT "user_id" INTO owner FROM "savings_goals" WHERE "id" = NEW."resource_id";
  END IF;
  IF owner IS NULL OR owner <> NEW."user_id" THEN
    RAISE EXCEPTION 'family share must reference a resource owned by the sharer'
      USING ERRCODE = '23514', CONSTRAINT = 'family_shares_resource_owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tw_trg_family_shares_owner
  BEFORE INSERT OR UPDATE OF "resource_type", "resource_id", "user_id" ON "family_shares"
  FOR EACH ROW EXECUTE FUNCTION tw_family_shares_owner();

-- Payment events are an append-only ledger of what the provider told us.
CREATE OR REPLACE FUNCTION tw_payment_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tw_trg_payment_events_immutable
  BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION tw_payment_events_immutable();