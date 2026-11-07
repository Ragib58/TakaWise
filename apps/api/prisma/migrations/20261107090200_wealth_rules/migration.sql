-- Phase 8 (ADR-022/023): database-level rules for investments, loans,
-- loan payments, net-worth items and valuations. Services enforce the same
-- rules with friendly errors; these are the backstop (defence in depth,
-- ADR-019). Catalogue: docs/architecture/erd.md.

-- ═══════════════ Ledger class by account type (replaces Phase 2 rule) ═══════════════
-- Liabilities: credit cards and borrowed loans. Everything else is an asset.

CREATE OR REPLACE FUNCTION "tw_trg_ledger_accounts_class"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type "FinancialAccountType";
  v_expected text;
BEGIN
  IF NEW."financial_account_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "type" INTO v_type FROM "financial_accounts" WHERE "id" = NEW."financial_account_id";
  v_expected := CASE WHEN v_type::text IN ('CREDIT_CARD_TRACKING', 'LOAN') THEN 'LIABILITY' ELSE 'ASSET' END;
  IF NEW."class"::text <> v_expected THEN
    PERFORM "tw_violation"('ledger_accounts_class_matches_account_type',
      format('%s accounts must map to a %s ledger account', v_type, v_expected));
  END IF;
  RETURN NEW;
END;
$$;

-- Earmark goals (ADR-009) may not point at any liability account.
CREATE OR REPLACE FUNCTION "tw_trg_savings_goals_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type "FinancialAccountType";
  v_currency char(3);
BEGIN
  SELECT "type", "currency" INTO v_type, v_currency
    FROM "financial_accounts" WHERE "id" = NEW."linked_account_id";
  IF v_type::text IN ('CREDIT_CARD_TRACKING', 'LOAN') THEN
    PERFORM "tw_violation"('savings_goals_linked_account_asset',
      'a savings goal cannot be earmarked against a liability account');
  END IF;
  IF v_currency <> NEW."currency" THEN
    PERFORM "tw_violation"('savings_goals_currency_matches_account',
      'goal currency must match the linked account currency');
  END IF;
  RETURN NEW;
END;
$$;

-- ═══════════════════════════ Investments ═══════════════════════════

ALTER TABLE "investments"
  ADD CONSTRAINT "investments_interest_rate_range"
    CHECK ("interest_rate" IS NULL OR ("interest_rate" >= 0 AND "interest_rate" <= 100)),
  ADD CONSTRAINT "investments_expected_value_positive"
    CHECK ("expected_maturity_value" IS NULL OR "expected_maturity_value" > 0),
  ADD CONSTRAINT "investments_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" > 0),
  ADD CONSTRAINT "investments_unit_needs_quantity"
    CHECK ("quantity_unit" IS NULL OR "quantity" IS NOT NULL);

CREATE FUNCTION "tw_trg_investments_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type text;
BEGIN
  SELECT "type"::text INTO v_type FROM "financial_accounts" WHERE "id" = NEW."account_id";
  IF v_type <> 'INVESTMENT' THEN
    PERFORM "tw_violation"('investments_account_type',
      format('investment details require an INVESTMENT account (got %s)', v_type));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "investments_account_rules"
  BEFORE INSERT OR UPDATE OF "account_id" ON "investments"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_investments_account"();

-- ═══════════════════════════════ Loans ═══════════════════════════════

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_principal_positive" CHECK ("principal" > 0),
  ADD CONSTRAINT "loans_interest_rate_range"
    CHECK ("interest_rate" IS NULL OR ("interest_rate" >= 0 AND "interest_rate" <= 100)),
  ADD CONSTRAINT "loans_term_range" CHECK ("term_months" IS NULL OR "term_months" BETWEEN 1 AND 600),
  ADD CONSTRAINT "loans_schedule_complete"
    CHECK (("term_months" IS NULL) = ("first_payment_date" IS NULL)),
  ADD CONSTRAINT "loans_counterparty_not_blank"
    CHECK ("counterparty" IS NULL OR btrim("counterparty") <> '');

-- Borrowed → LOAN (liability); lent → LOAN_RECEIVABLE (asset).
CREATE FUNCTION "tw_trg_loans_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type text;
  v_expected text;
BEGIN
  SELECT "type"::text INTO v_type FROM "financial_accounts" WHERE "id" = NEW."account_id";
  v_expected := CASE WHEN NEW."direction" = 'BORROWED' THEN 'LOAN' ELSE 'LOAN_RECEIVABLE' END;
  IF v_type IS DISTINCT FROM v_expected THEN
    PERFORM "tw_violation"('loans_account_type',
      format('a %s loan requires a %s account (got %s)', NEW."direction", v_expected, v_type));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "loans_account_rules"
  BEFORE INSERT OR UPDATE OF "account_id", "direction" ON "loans"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_loans_account"();

-- ═══════════════════════════ Loan payments ═══════════════════════════

ALTER TABLE "loan_payments"
  ADD CONSTRAINT "loan_payments_amounts_non_negative" CHECK ("principal" >= 0 AND "interest" >= 0),
  ADD CONSTRAINT "loan_payments_amount_positive" CHECK ("principal" + "interest" > 0),
  ADD CONSTRAINT "loan_payments_principal_has_transfer"
    CHECK (("principal" > 0) = ("transfer_id" IS NOT NULL)),
  ADD CONSTRAINT "loan_payments_interest_has_transaction"
    CHECK (("interest" > 0) = ("transaction_id" IS NOT NULL)),
  ADD CONSTRAINT "loan_payments_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "loan_payments_reversal_consistent"
    CHECK (("status" = 'REVERSED') = ("reversed_at" IS NOT NULL));

-- The linked postings must really be this payment: the transfer moves exactly
-- the principal in or out of the loan account, the transaction is the interest.
CREATE FUNCTION "tw_trg_loan_payments_consistency"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_currency char(3);
  v_amount numeric;
  v_source uuid;
  v_destination uuid;
BEGIN
  SELECT "currency" INTO v_currency FROM "financial_accounts" WHERE "id" = NEW."loan_id";
  IF v_currency <> NEW."currency" THEN
    PERFORM "tw_violation"('loan_payments_currency_matches', 'payment currency must match the loan');
  END IF;
  IF NEW."transfer_id" IS NOT NULL THEN
    SELECT "amount", "source_account_id", "destination_account_id"
      INTO v_amount, v_source, v_destination
      FROM "transfers" WHERE "id" = NEW."transfer_id";
    IF v_amount <> NEW."principal" OR NEW."loan_id" NOT IN (v_source, v_destination) THEN
      PERFORM "tw_violation"('loan_payments_transfer_matches',
        'the principal transfer must move exactly the principal to or from the loan account');
    END IF;
  END IF;
  IF NEW."transaction_id" IS NOT NULL THEN
    SELECT "amount" INTO v_amount FROM "transactions" WHERE "id" = NEW."transaction_id";
    IF v_amount <> NEW."interest" THEN
      PERFORM "tw_violation"('loan_payments_interest_matches',
        'the interest transaction must equal the interest amount');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "loan_payments_consistency"
  BEFORE INSERT ON "loan_payments"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_loan_payments_consistency"();

-- Append-only: never deleted; the only change is POSTED → REVERSED.
CREATE FUNCTION "tw_trg_loan_payments_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "tw_violation"('loan_payments_append_only',
      'loan payments cannot be deleted; reverse them instead');
  END IF;
  IF (NEW."user_id", NEW."loan_id", NEW."transfer_id", NEW."transaction_id", NEW."principal",
      NEW."interest", NEW."currency", NEW."paid_on", NEW."created_at")
     IS DISTINCT FROM
     (OLD."user_id", OLD."loan_id", OLD."transfer_id", OLD."transaction_id", OLD."principal",
      OLD."interest", OLD."currency", OLD."paid_on", OLD."created_at")
     OR NEW."id" <> OLD."id"
     OR NOT (OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED') THEN
    PERFORM "tw_violation"('loan_payments_append_only',
      'a loan payment can only change from POSTED to REVERSED');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "loan_payments_guard"
  BEFORE UPDATE OR DELETE ON "loan_payments"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_loan_payments_guard"();

-- ═══════════════════════════ Net-worth items ═══════════════════════════

ALTER TABLE "net_worth_items"
  ADD CONSTRAINT "net_worth_items_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "net_worth_items_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "net_worth_items_archive_consistent"
    CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL)),
  ADD CONSTRAINT "net_worth_items_kind_matches_side"
    CHECK (("side" = 'ASSET') =
           ("kind" IN ('REAL_ESTATE', 'VEHICLE', 'JEWELLERY', 'BUSINESS', 'OTHER_ASSET')));

CREATE UNIQUE INDEX "net_worth_items_user_active_name_key"
  ON "net_worth_items" ("user_id", lower("name")) WHERE "status" = 'ACTIVE';

-- ═══════════════════════════════ Valuations ═══════════════════════════════

ALTER TABLE "valuations"
  ADD CONSTRAINT "valuations_one_target"
    CHECK (("investment_id" IS NULL) <> ("item_id" IS NULL)),
  ADD CONSTRAINT "valuations_value_non_negative" CHECK ("value" >= 0),
  ADD CONSTRAINT "valuations_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- No verified data source is connected (Phase 8 rule): only user-entered or
  -- estimated values exist. Drop this when a real connector is added.
  ADD CONSTRAINT "valuations_verified_requires_source" CHECK ("source" <> 'VERIFIED');

CREATE UNIQUE INDEX "valuations_investment_date_key"
  ON "valuations" ("investment_id", "valued_on") WHERE "investment_id" IS NOT NULL;
CREATE UNIQUE INDEX "valuations_item_date_key"
  ON "valuations" ("item_id", "valued_on") WHERE "item_id" IS NOT NULL;

-- Currency must match the valued thing; an investment cannot be valued before it was opened.
CREATE FUNCTION "tw_trg_valuations_consistency"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_currency char(3);
  v_opened date;
BEGIN
  IF NEW."investment_id" IS NOT NULL THEN
    SELECT "currency", "opening_date" INTO v_currency, v_opened
      FROM "financial_accounts" WHERE "id" = NEW."investment_id";
    IF NEW."valued_on" < v_opened THEN
      PERFORM "tw_violation"('valuations_after_opening',
        'an investment cannot be valued before its opening date');
    END IF;
  ELSE
    SELECT "currency" INTO v_currency FROM "net_worth_items" WHERE "id" = NEW."item_id";
  END IF;
  IF v_currency <> NEW."currency" THEN
    PERFORM "tw_violation"('valuations_currency_matches', 'valuation currency must match');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "valuations_consistency"
  BEFORE INSERT ON "valuations"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_valuations_consistency"();

-- A valuation is a dated fact: correct it by deleting and re-entering, never by editing.
CREATE TRIGGER "valuations_immutable"
  BEFORE UPDATE ON "valuations"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_forbid_change"();
