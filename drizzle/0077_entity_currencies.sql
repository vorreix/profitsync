-- Budgets, per-client caps and quotations remember their own currency.
--
-- A spending budget, a v1 per-client cap (and each row of its history) and a
-- quotation KEEP the currency they were created in. Without a column they were
-- read in whatever the workspace's currency was TODAY, so switching the
-- reporting currency silently relabelled every limit and every quote
-- (₹50,000 became €50,000). A later reporting change converts them for
-- display; it never relabels them.
--
-- Caps, their history and spending budgets are backfilled from the reporting
-- currency (what they were JUDGED in until now); quotations from
-- organizations.currency (what they were PRINTED in — see below).
--
-- Additive and re-runnable: nullable columns, backfills guarded by IS NULL,
-- constraints dropped before they are added (0069's pattern), every statement
-- separated by a statement-breakpoint marker for the neon-http migrator.
-- Amounts are never touched — only the label they were always meant in.

ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
ALTER TABLE "budget_history" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint

UPDATE "budgets" b
SET "currency_code" = coalesce(o."reporting_currency", upper(o."currency"))
FROM "organizations" o
WHERE b."organization_id" = o."id"
  AND b."currency_code" IS NULL
  AND coalesce(o."reporting_currency", upper(o."currency")) ~ '^[A-Z]{3}$';--> statement-breakpoint

UPDATE "budget_history" h
SET "currency_code" = coalesce(o."reporting_currency", upper(o."currency"))
FROM "organizations" o
WHERE h."organization_id" = o."id"
  AND h."currency_code" IS NULL
  AND coalesce(o."reporting_currency", upper(o."currency")) ~ '^[A-Z]{3}$';--> statement-breakpoint

-- A quotation was always SHOWN and PRINTED in organizations.currency (the list
-- through the active org, the PDF snapshot and its hash through org.currency),
-- so that — not the reporting currency — is the label it was meant in. Where
-- the two columns drifted (onboarding once wrote only `currency`), backfilling
-- from reporting_currency would relabel every quote and mark every ready PDF
-- stale; this way the snapshot hash is unchanged everywhere. A workspace whose
-- `currency` itself is wrong is repaired by scripts/relabel-org-currency.mjs.
UPDATE "quotations" q
SET "currency_code" = coalesce(upper(o."currency"), o."reporting_currency")
FROM "organizations" o
WHERE q."organization_id" = o."id"
  AND q."currency_code" IS NULL
  AND coalesce(upper(o."currency"), o."reporting_currency") ~ '^[A-Z]{3}$';--> statement-breakpoint

-- Spending budgets written since 0069 stored no currency. A sub-budget takes
-- its parent's (it lives in its parent's scope and window); everything else
-- the workspace's reporting currency — what a NULL row was read in until now.
UPDATE "spending_budgets" c
SET "currency_code" = p."currency_code"
FROM "spending_budgets" p
WHERE c."parent_id" = p."id"
  AND c."currency_code" IS NULL
  AND p."currency_code" IS NOT NULL;--> statement-breakpoint
UPDATE "spending_budgets" b
SET "currency_code" = coalesce(o."reporting_currency", upper(o."currency"))
FROM "organizations" o
WHERE b."organization_id" = o."id"
  AND b."currency_code" IS NULL
  AND coalesce(o."reporting_currency", upper(o."currency")) ~ '^[A-Z]{3}$';--> statement-breakpoint

ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_currency_code_check";--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "budget_history" DROP CONSTRAINT IF EXISTS "budget_history_currency_code_check";--> statement-breakpoint
ALTER TABLE "budget_history" ADD CONSTRAINT "budget_history_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_currency_code_check";--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');
