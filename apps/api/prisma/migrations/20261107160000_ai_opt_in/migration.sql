-- CreateEnum
CREATE TYPE "AiConsentScope" AS ENUM ('INSIGHTS', 'TRANSACTION_DRAFT', 'RECEIPT_OCR');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('MONTHLY_SUMMARY', 'UNUSUAL_SPENDING', 'SAVINGS_SUGGESTIONS', 'TRANSACTION_DRAFT', 'RECEIPT_OCR');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('SUCCEEDED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_consents" (
    "user_id" UUID NOT NULL,
    "scope" "AiConsentScope" NOT NULL,
    "policy_version" VARCHAR(20) NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_consents_pkey" PRIMARY KEY ("user_id","scope")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "status" "AiRequestStatus" NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(60),
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AiFeature" NOT NULL,
    "month" CHAR(7) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "locale" "Locale" NOT NULL,
    "facts_hash" CHAR(64) NOT NULL,
    "content" JSONB NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_requests_user_id_created_at_idx" ON "ai_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_user_id_kind_month_currency_locale_key" ON "ai_insights"("user_id", "kind", "month", "currency", "locale");

-- AddForeignKey
ALTER TABLE "ai_consents" ADD CONSTRAINT "ai_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Phase 9 rules (ADR-024) ───
ALTER TABLE "ai_consents"
  ADD CONSTRAINT "ai_consents_revoked_after_granted"
  CHECK ("revoked_at" IS NULL OR "revoked_at" >= "granted_at");

ALTER TABLE "ai_requests"
  ADD CONSTRAINT "ai_requests_tokens_non_negative"
  CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "duration_ms" >= 0);

ALTER TABLE "ai_insights"
  ADD CONSTRAINT "ai_insights_kind_is_insight"
  CHECK ("kind" IN ('MONTHLY_SUMMARY', 'UNUSUAL_SPENDING', 'SAVINGS_SUGGESTIONS')),
  ADD CONSTRAINT "ai_insights_month_format"
  CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');