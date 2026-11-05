-- Phase 5: planning-module invariants (budgets, goals, reminders, categories).

-- One active budget per user, period start and currency (archived budgets may repeat).
CREATE UNIQUE INDEX "budgets_user_period_currency_active_key"
  ON "budgets" ("user_id", "start_date", "currency")
  WHERE "archived_at" IS NULL;

ALTER TABLE "savings_goals"
  ADD CONSTRAINT "savings_goals_achieved_has_timestamp"
    CHECK ("status" <> 'ACHIEVED' OR "achieved_at" IS NOT NULL),
  ADD CONSTRAINT "savings_goals_archive_consistent"
    CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "reminders"
  ADD CONSTRAINT "reminders_completed_consistent"
    CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL));

-- Reminder dispatcher scans due, un-notified, pending reminders.
CREATE INDEX "reminders_due_unnotified_idx"
  ON "reminders" ("due_at")
  WHERE "status" = 'PENDING' AND "notified_at" IS NULL;

-- Categories: at most two levels (parent → child), in addition to the
-- same-owner / same-type rules from the ledger_constraints migration.
CREATE OR REPLACE FUNCTION "tw_trg_categories_parent"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent_owner uuid;
  v_parent_type "CategoryType";
  v_grandparent uuid;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "user_id", "type", "parent_id" INTO v_parent_owner, v_parent_type, v_grandparent
    FROM "categories" WHERE "id" = NEW."parent_id";
  IF v_parent_owner IS NOT NULL AND v_parent_owner IS DISTINCT FROM NEW."user_id" THEN
    PERFORM "tw_violation"('categories_parent_owner', 'parent category belongs to another user');
  END IF;
  IF v_parent_type <> NEW."type" THEN
    PERFORM "tw_violation"('categories_parent_type', 'parent category must have the same type');
  END IF;
  IF v_grandparent IS NOT NULL THEN
    PERFORM "tw_violation"('categories_max_depth', 'categories can only be nested one level deep');
  END IF;
  RETURN NEW;
END;
$$;
