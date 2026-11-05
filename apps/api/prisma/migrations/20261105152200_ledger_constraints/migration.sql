-- TakaWise: database-level financial invariants (ADR-005, ADR-013).
--
-- Prisma cannot express these, so they live here. The application enforces the
-- same rules first (friendly errors); the database is the last line of defence.
-- Error convention: CHECK-style violations raise SQLSTATE 23514 (check_violation)
-- with a named CONSTRAINT; immutability violations raise SQLSTATE 55000
-- (object_not_in_prerequisite_state).

-- ════════════════════════ Generic CHECK constraints ════════════════════════

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized"
    CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1);

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_currency_iso" CHECK ("default_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "user_profiles_full_name_not_blank" CHECK (btrim("full_name") <> '');

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_after_creation" CHECK ("expires_at" > "created_at");

ALTER TABLE "verification_tokens"
  ADD CONSTRAINT "verification_tokens_attempts_non_negative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "verification_tokens_expiry_after_creation" CHECK ("expires_at" > "created_at");

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "financial_accounts_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "financial_accounts_opening_balance_non_negative" CHECK ("opening_balance" >= 0),
  ADD CONSTRAINT "financial_accounts_credit_limit_positive" CHECK ("credit_limit" IS NULL OR "credit_limit" > 0),
  ADD CONSTRAINT "financial_accounts_credit_limit_card_only"
    CHECK ("credit_limit" IS NULL OR "type" = 'CREDIT_CARD_TRACKING'),
  ADD CONSTRAINT "financial_accounts_archive_consistent"
    CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- Active account names are unique per user (case-insensitive). Archived names may repeat.
CREATE UNIQUE INDEX "financial_accounts_user_active_name_key"
  ON "financial_accounts" ("user_id", lower("name")) WHERE "status" = 'ACTIVE';

ALTER TABLE "ledger_account_templates"
  ADD CONSTRAINT "ledger_account_templates_normal_balance_matches_class" CHECK (
    ("class" IN ('ASSET', 'EXPENSE') AND "normal_balance" = 'DEBIT')
    OR ("class" IN ('LIABILITY', 'EQUITY', 'INCOME') AND "normal_balance" = 'CREDIT'));

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_exactly_one_kind"
    CHECK (("financial_account_id" IS NULL) <> ("system_code" IS NULL)),
  ADD CONSTRAINT "ledger_accounts_normal_balance_matches_class" CHECK (
    ("class" IN ('ASSET', 'EXPENSE') AND "normal_balance" = 'DEBIT')
    OR ("class" IN ('LIABILITY', 'EQUITY', 'INCOME') AND "normal_balance" = 'CREDIT')),
  ADD CONSTRAINT "ledger_accounts_system_code_matches_class" CHECK (
    "system_code" IS NULL
    OR ("system_code" = 'EQUITY_OPENING_BALANCE' AND "class" = 'EQUITY')
    OR ("system_code" = 'INCOME' AND "class" = 'INCOME')
    OR ("system_code" = 'EXPENSE' AND "class" = 'EXPENSE'));

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "journal_entries_reversal_link" CHECK (("kind" = 'REVERSAL') = ("reverses_id" IS NOT NULL)),
  ADD CONSTRAINT "journal_entries_not_self_reversal" CHECK ("reverses_id" IS NULL OR "reverses_id" <> "id");

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_sided_positive"
    CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)),
  ADD CONSTRAINT "journal_lines_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "transactions_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "transactions_reversal_consistent" CHECK (
    ("status" = 'REVERSED') = ("reversal_journal_entry_id" IS NOT NULL)
    AND ("status" = 'REVERSED') = ("reversed_at" IS NOT NULL));

ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "transfers_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "transfers_distinct_accounts" CHECK ("source_account_id" <> "destination_account_id"),
  ADD CONSTRAINT "transfers_reversal_consistent" CHECK (
    ("status" = 'REVERSED') = ("reversal_journal_entry_id" IS NOT NULL)
    AND ("status" = 'REVERSED') = ("reversed_at" IS NOT NULL));

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "idempotency_keys_response_status_http" CHECK ("response_status" BETWEEN 100 AND 599);

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_system_ownership" CHECK ("is_system" = ("user_id" IS NULL)),
  ADD CONSTRAINT "categories_system_key_only_for_system" CHECK (("system_key" IS NOT NULL) = "is_system"),
  ADD CONSTRAINT "categories_names_not_blank" CHECK (btrim("name_en") <> '' AND btrim("name_bn") <> ''),
  ADD CONSTRAINT "categories_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "categories_archive_consistent" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- Custom category names are unique per user and type among active categories.
CREATE UNIQUE INDEX "categories_user_type_active_name_key"
  ON "categories" ("user_id", "type", lower("name_en"))
  WHERE "user_id" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "budgets_date_range" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "budgets_overall_amount_positive" CHECK ("overall_amount" IS NULL OR "overall_amount" > 0),
  ADD CONSTRAINT "budgets_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "budget_items"
  ADD CONSTRAINT "budget_items_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "savings_goals"
  ADD CONSTRAINT "savings_goals_target_amount_positive" CHECK ("target_amount" > 0),
  ADD CONSTRAINT "savings_goals_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "savings_goals_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "goal_contributions"
  ADD CONSTRAINT "goal_contributions_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "goal_contributions_reversal_link" CHECK (("kind" = 'REVERSAL') = ("reverses_id" IS NOT NULL)),
  ADD CONSTRAINT "goal_contributions_not_self_reversal" CHECK ("reverses_id" IS NULL OR "reverses_id" <> "id");

ALTER TABLE "reminders"
  ADD CONSTRAINT "reminders_title_not_blank" CHECK (btrim("title") <> '');

ALTER TABLE "files"
  ADD CONSTRAINT "files_size_positive" CHECK ("size_bytes" > 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("attempts" >= 0);

-- ═══════════════════════════ Helper: raise ═══════════════════════════

CREATE FUNCTION "tw_violation"(p_constraint text, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', p_message USING ERRCODE = 'check_violation', CONSTRAINT = p_constraint;
END;
$$;

-- ═════════════════ Balanced-journal invariant (deferred, ADR-005) ═════════════════
-- Checked at COMMIT so lines can be inserted one by one inside a transaction.
-- Rules: ≥ 2 lines; Σdebit = Σcredit; every line in the entry's currency; every
-- line's ledger account owned by the entry's user.

CREATE FUNCTION "tw_assert_journal_balanced"(p_entry_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
  v_currency char(3);
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
  v_bad_currency integer;
  v_bad_owner integer;
BEGIN
  SELECT "user_id", "currency" INTO v_user_id, v_currency
    FROM "journal_entries" WHERE "id" = p_entry_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*),
         coalesce(sum(l."debit"), 0),
         coalesce(sum(l."credit"), 0),
         count(*) FILTER (WHERE l."currency" <> v_currency),
         count(*) FILTER (WHERE la."user_id" <> v_user_id)
    INTO v_lines, v_debit, v_credit, v_bad_currency, v_bad_owner
    FROM "journal_lines" l
    JOIN "ledger_accounts" la ON la."id" = l."ledger_account_id"
   WHERE l."journal_entry_id" = p_entry_id;

  IF v_lines < 2 THEN
    PERFORM "tw_violation"('journal_entries_min_two_lines',
      format('journal entry %s must have at least 2 lines (has %s)', p_entry_id, v_lines));
  END IF;
  IF v_debit <> v_credit THEN
    PERFORM "tw_violation"('journal_entries_balanced',
      format('journal entry %s is unbalanced: debit %s <> credit %s', p_entry_id, v_debit, v_credit));
  END IF;
  IF v_bad_currency > 0 THEN
    PERFORM "tw_violation"('journal_lines_currency_matches_entry',
      format('journal entry %s has lines in a currency other than %s', p_entry_id, v_currency));
  END IF;
  IF v_bad_owner > 0 THEN
    PERFORM "tw_violation"('journal_lines_ledger_account_owner',
      format('journal entry %s posts to ledger accounts of another user', p_entry_id));
  END IF;
END;
$$;

CREATE FUNCTION "tw_trg_journal_lines_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "tw_assert_journal_balanced"(NEW."journal_entry_id");
  RETURN NULL;
END;
$$;

CREATE FUNCTION "tw_trg_journal_entries_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "tw_assert_journal_balanced"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_journal_lines_balanced"();

-- Also fires for an entry inserted with no lines at all.
CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_journal_entries_balanced"();

-- ═══════════════════════════ Reversal rules ═══════════════════════════

CREATE FUNCTION "tw_trg_journal_entries_reversal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_original "journal_entries"%ROWTYPE;
BEGIN
  IF NEW."reverses_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_original FROM "journal_entries" WHERE "id" = NEW."reverses_id";
  IF v_original."kind" = 'REVERSAL' THEN
    PERFORM "tw_violation"('journal_entries_no_reversal_of_reversal',
      format('journal entry %s is itself a reversal and cannot be reversed', NEW."reverses_id"));
  END IF;
  IF v_original."currency" <> NEW."currency" THEN
    PERFORM "tw_violation"('journal_entries_reversal_currency',
      'a reversal must use the currency of the original entry');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_entries_reversal_rules"
  BEFORE INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_journal_entries_reversal"();

-- ═══════════════════════════ Immutability ═══════════════════════════

CREATE FUNCTION "tw_trg_forbid_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not allowed: records are immutable', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;

CREATE TRIGGER "journal_entries_immutable"
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_forbid_change"();

CREATE TRIGGER "journal_lines_immutable"
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_forbid_change"();

CREATE TRIGGER "audit_logs_immutable"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_forbid_change"();

-- Transactions/transfers: financial fields are frozen once posted. The only
-- permitted changes are the POSTED -> REVERSED transition (with its reversal
-- journal) and editing the free-text description. Rows are never deleted.
CREATE FUNCTION "tw_trg_posting_update_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on "%" is not allowed: post a reversal instead', TG_TABLE_NAME
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'reversal_journal_entry_id', 'reversed_at', 'description', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'reversal_journal_entry_id', 'reversed_at', 'description', 'updated_at']) THEN
    RAISE EXCEPTION 'financial fields of "%" % are immutable; post a reversal instead', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF OLD."status" = 'REVERSED' AND (
       NEW."status" <> 'REVERSED'
       OR NEW."reversal_journal_entry_id" IS DISTINCT FROM OLD."reversal_journal_entry_id"
       OR NEW."reversed_at" IS DISTINCT FROM OLD."reversed_at") THEN
    RAISE EXCEPTION '"%" % is already reversed', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF NEW."status" = 'REVERSED' AND OLD."status" = 'POSTED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "journal_entries" r
       WHERE r."id" = NEW."reversal_journal_entry_id"
         AND r."kind" = 'REVERSAL'
         AND r."reverses_id" = OLD."journal_entry_id") THEN
      PERFORM "tw_violation"(TG_TABLE_NAME || '_reversal_matches_journal',
        'reversal_journal_entry_id must be the REVERSAL entry of this record''s journal');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "transactions_update_guard"
  BEFORE UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_posting_update_guard"();

CREATE TRIGGER "transfers_update_guard"
  BEFORE UPDATE OR DELETE ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_posting_update_guard"();

-- Goal contributions are append-only; only POSTED -> REVERSED is allowed.
CREATE FUNCTION "tw_trg_goal_contribution_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on "goal_contributions" is not allowed: add a reversal instead'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
     OR NOT (OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED') THEN
    RAISE EXCEPTION 'goal contribution % is immutable (only POSTED -> REVERSED is allowed)', OLD."id"
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "goal_contributions_guard"
  BEFORE UPDATE OR DELETE ON "goal_contributions"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_goal_contribution_guard"();

-- ═══════════════════ Cross-table consistency on insert ═══════════════════

-- Ledger account class must match the financial account type (ADR-008).
CREATE FUNCTION "tw_trg_ledger_accounts_class"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type "FinancialAccountType";
BEGIN
  IF NEW."financial_account_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "type" INTO v_type FROM "financial_accounts" WHERE "id" = NEW."financial_account_id";
  IF (v_type = 'CREDIT_CARD_TRACKING' AND NEW."class" <> 'LIABILITY')
     OR (v_type <> 'CREDIT_CARD_TRACKING' AND NEW."class" <> 'ASSET') THEN
    PERFORM "tw_violation"('ledger_accounts_class_matches_account_type',
      format('%s accounts must map to a %s ledger account', v_type,
        CASE WHEN v_type = 'CREDIT_CARD_TRACKING' THEN 'LIABILITY' ELSE 'ASSET' END));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_accounts_class_rules"
  BEFORE INSERT OR UPDATE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_ledger_accounts_class"();

-- Category usable by a user: system category or owned by that user, of the right type.
CREATE FUNCTION "tw_assert_category_usable"(
  p_category_id uuid, p_user_id uuid, p_type text, p_constraint_prefix text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_owner uuid;
  v_type text;
BEGIN
  SELECT "user_id", "type"::text INTO v_owner, v_type FROM "categories" WHERE "id" = p_category_id;
  IF v_owner IS NOT NULL AND v_owner <> p_user_id THEN
    PERFORM "tw_violation"(p_constraint_prefix || '_category_owner',
      'category belongs to another user');
  END IF;
  IF v_type <> p_type THEN
    PERFORM "tw_violation"(p_constraint_prefix || '_category_type',
      format('category type %s does not match %s', v_type, p_type));
  END IF;
END;
$$;

CREATE FUNCTION "tw_trg_transactions_consistency"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
  v_journal_currency char(3);
  v_account_currency char(3);
BEGIN
  PERFORM "tw_assert_category_usable"(NEW."category_id", NEW."user_id", NEW."type"::text, 'transactions');

  SELECT "kind"::text, "currency" INTO v_kind, v_journal_currency
    FROM "journal_entries" WHERE "id" = NEW."journal_entry_id";
  IF v_kind <> NEW."type"::text THEN
    PERFORM "tw_violation"('transactions_journal_kind',
      format('%s transaction must reference a %s journal entry (got %s)', NEW."type", NEW."type", v_kind));
  END IF;

  SELECT "currency" INTO v_account_currency FROM "financial_accounts" WHERE "id" = NEW."account_id";
  IF NEW."currency" <> v_journal_currency OR NEW."currency" <> v_account_currency THEN
    PERFORM "tw_violation"('transactions_currency_matches',
      'transaction currency must match its account and journal entry');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transactions_consistency"
  BEFORE INSERT ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_transactions_consistency"();

CREATE FUNCTION "tw_trg_transfers_consistency"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
  v_journal_currency char(3);
  v_source_currency char(3);
  v_destination_currency char(3);
BEGIN
  SELECT "kind"::text, "currency" INTO v_kind, v_journal_currency
    FROM "journal_entries" WHERE "id" = NEW."journal_entry_id";
  IF v_kind <> 'TRANSFER' THEN
    PERFORM "tw_violation"('transfers_journal_kind',
      format('transfer must reference a TRANSFER journal entry (got %s)', v_kind));
  END IF;

  SELECT "currency" INTO v_source_currency FROM "financial_accounts" WHERE "id" = NEW."source_account_id";
  SELECT "currency" INTO v_destination_currency FROM "financial_accounts" WHERE "id" = NEW."destination_account_id";
  IF NEW."currency" <> v_journal_currency
     OR NEW."currency" <> v_source_currency
     OR NEW."currency" <> v_destination_currency THEN
    PERFORM "tw_violation"('transfers_same_currency',
      'MVP transfers require both accounts and the journal to share one currency (ADR-016)');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transfers_consistency"
  BEFORE INSERT ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_transfers_consistency"();

CREATE FUNCTION "tw_trg_categories_parent"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent_owner uuid;
  v_parent_type "CategoryType";
BEGIN
  IF NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "user_id", "type" INTO v_parent_owner, v_parent_type FROM "categories" WHERE "id" = NEW."parent_id";
  IF v_parent_owner IS NOT NULL AND v_parent_owner IS DISTINCT FROM NEW."user_id" THEN
    PERFORM "tw_violation"('categories_parent_owner', 'parent category belongs to another user');
  END IF;
  IF v_parent_type <> NEW."type" THEN
    PERFORM "tw_violation"('categories_parent_type', 'parent category must have the same type');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "categories_parent_rules"
  BEFORE INSERT OR UPDATE OF "parent_id", "type", "user_id" ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_categories_parent"();

CREATE FUNCTION "tw_trg_budget_items_category"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT "user_id" INTO v_user_id FROM "budgets" WHERE "id" = NEW."budget_id";
  PERFORM "tw_assert_category_usable"(NEW."category_id", v_user_id, 'EXPENSE', 'budget_items');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "budget_items_category_rules"
  BEFORE INSERT OR UPDATE OF "category_id", "budget_id" ON "budget_items"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_budget_items_category"();

-- Earmark goals (ADR-009): linked account must be an asset account in the goal's currency.
CREATE FUNCTION "tw_trg_savings_goals_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type "FinancialAccountType";
  v_currency char(3);
BEGIN
  SELECT "type", "currency" INTO v_type, v_currency
    FROM "financial_accounts" WHERE "id" = NEW."linked_account_id";
  IF v_type = 'CREDIT_CARD_TRACKING' THEN
    PERFORM "tw_violation"('savings_goals_linked_account_asset',
      'a savings goal cannot be earmarked against a credit-card (liability) account');
  END IF;
  IF v_currency <> NEW."currency" THEN
    PERFORM "tw_violation"('savings_goals_currency_matches_account',
      'goal currency must match the linked account currency');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "savings_goals_account_rules"
  BEFORE INSERT OR UPDATE OF "linked_account_id", "currency" ON "savings_goals"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_savings_goals_account"();

CREATE FUNCTION "tw_trg_goal_contributions_reversal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_original "goal_contributions"%ROWTYPE;
BEGIN
  IF NEW."reverses_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_original FROM "goal_contributions" WHERE "id" = NEW."reverses_id";
  IF v_original."goal_id" <> NEW."goal_id" THEN
    PERFORM "tw_violation"('goal_contributions_reversal_same_goal',
      'a reversal must belong to the same goal as the original');
  END IF;
  IF v_original."kind" = 'REVERSAL' THEN
    PERFORM "tw_violation"('goal_contributions_no_reversal_of_reversal',
      'a reversal cannot be reversed');
  END IF;
  IF v_original."amount" <> NEW."amount" THEN
    PERFORM "tw_violation"('goal_contributions_reversal_amount',
      'a reversal must have the same amount as the original');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "goal_contributions_reversal_rules"
  BEFORE INSERT ON "goal_contributions"
  FOR EACH ROW EXECUTE FUNCTION "tw_trg_goal_contributions_reversal"();
