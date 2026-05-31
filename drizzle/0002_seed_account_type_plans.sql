-- Data migration (hand-authored): backfill account types and seed the
-- Personal / Business plan families that drive onboarding + checkout.
--
-- Idempotent by design:
--   * backfills only fill NULLs, so re-running never clobbers chosen values
--   * plan inserts use ON CONFLICT (key) DO NOTHING, so admin-edited product
--     IDs / prices are preserved across redeploys.

-- Backfill org account types from the legacy is_personal flag.
UPDATE "organizations"
SET "account_type" = CASE WHEN "is_personal" THEN 'personal' ELSE 'business' END
WHERE "account_type" IS NULL;
--> statement-breakpoint

-- Personal Starter — stripped-down personal finance tier.
INSERT INTO "plans" (
  "key", "name", "account_type", "is_active",
  "monthly_price_usd", "yearly_price_usd", "monthly_discount_pct", "yearly_discount_pct",
  "dodo_product_monthly", "dodo_product_yearly", "limits", "geo_pricing"
) VALUES (
  'personal', 'Personal Starter', 'personal', true,
  '4.99', '49.90', 50, 50,
  'pdt_0Ng2BsmUPkjxW6ctpcCzc', 'pdt_0Ng2BqlRkoO9Kcfm2vKDq',
  '{"clients":1,"transactionsPerClient":100000,"quotations":0,"attachmentSizeKb":5120,"attachmentsPerTx":5,"noteLength":5000}'::jsonb,
  '{}'::jsonb
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Business Starter — full multi-client / quotations / team experience.
INSERT INTO "plans" (
  "key", "name", "account_type", "is_active",
  "monthly_price_usd", "yearly_price_usd", "monthly_discount_pct", "yearly_discount_pct",
  "dodo_product_monthly", "dodo_product_yearly", "limits", "geo_pricing"
) VALUES (
  'business', 'Business Starter', 'business', true,
  '9.99', '99.90', 50, 50,
  'pdt_0Ng1aRiJJeQqxHdzh6yT2', 'pdt_0Ng2A5nygUPzUZV3ugMa0',
  '{"clients":100000,"transactionsPerClient":100000,"quotations":100000,"attachmentSizeKb":10240,"attachmentsPerTx":10,"noteLength":100000}'::jsonb,
  '{}'::jsonb
) ON CONFLICT ("key") DO NOTHING;
