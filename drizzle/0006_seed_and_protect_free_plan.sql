-- Hand-authored data + safeguard migration.
--
-- Goal: the Free plan must ALWAYS exist and can NEVER be deleted. This is the
-- DB-level half of that guarantee (the admin API + UI enforce it too).
--
-- Idempotent by design:
--   * the plan insert uses ON CONFLICT (key) DO NOTHING
--   * the trigger function/trigger use CREATE OR REPLACE / DROP IF EXISTS
--   * the subscription backfill only inserts where one is missing

-- 1. Seed the shared Free tier (account_type NULL → applies to every workspace).
INSERT INTO "plans" (
  "key", "name", "description", "account_type", "is_active",
  "monthly_price_usd", "yearly_price_usd", "monthly_discount_pct", "yearly_discount_pct",
  "limits", "feature_labels", "geo_pricing"
) VALUES (
  'free', 'Free', 'Everything you need to get started — free forever.', NULL, true,
  '0', '0', 0, 0,
  '{"clients":10,"transactionsPerClient":30,"quotations":30,"attachmentSizeKb":1024,"attachmentsPerTx":1,"noteLength":200}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- 2. Make sure the seeded Free plan is always active (in case a prior row had it disabled).
UPDATE "plans" SET "is_active" = true WHERE "key" = 'free';
--> statement-breakpoint

-- 3. Guard: refuse to delete the Free plan at the database level.
CREATE OR REPLACE FUNCTION "prevent_free_plan_delete"() RETURNS trigger AS $$
BEGIN
  IF OLD."key" = 'free' THEN
    RAISE EXCEPTION 'The Free plan is required and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "plans_protect_free_delete" ON "plans";
--> statement-breakpoint

CREATE TRIGGER "plans_protect_free_delete"
  BEFORE DELETE ON "plans"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_free_plan_delete"();
--> statement-breakpoint

-- 4. Backfill: every organization must have a subscription (defaults to Free).
INSERT INTO "subscriptions" ("organization_id", "plan_key", "status")
SELECT o."id", 'free', 'active'
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "subscriptions" s WHERE s."organization_id" = o."id"
);
