-- Multi-currency foundation: additive, reversible currency metadata. Amounts
-- are deliberately not transformed. Nullable columns permit an audit before
-- NOT NULL is enforced.
--
-- Every statement is separated by a statement-breakpoint marker: the neon-http
-- migrator (scripts/db-migrate.mjs) sends each chunk as ONE query, and Neon's
-- HTTP endpoint rejects multi-statement queries. Constraints are dropped before
-- they are added so a re-run after a partial failure cannot wedge the deploy
-- (the migrator records a migration only after the whole batch succeeds).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "reporting_currency" text;--> statement-breakpoint
UPDATE "organizations"
SET "reporting_currency" = upper("currency")
WHERE "reporting_currency" IS NULL;--> statement-breakpoint

ALTER TABLE "wealth_accounts" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
UPDATE "wealth_accounts" wa
SET "currency_code" = upper(o."currency")
FROM "organizations" o
WHERE wa."organization_id" = o."id"
  AND wa."currency_code" IS NULL;--> statement-breakpoint

-- Multiple cash wallets are required for multiple currencies. Keep only the
-- lazy default row unique so concurrent first reads cannot create duplicates.
DROP INDEX IF EXISTS "wealth_accounts_one_active_cash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wealth_accounts_one_default_cash_idx"
  ON "wealth_accounts" ("organization_id")
  WHERE "type" = 'cash' AND "bank_name" = 'Cash in Hand' AND "archived_at" IS NULL;--> statement-breakpoint

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
UPDATE "transactions" t
SET "currency_code" = upper(wa."currency_code")
FROM "wealth_accounts" wa
WHERE t."wealth_account_id" = wa."id"
  AND t."currency_code" IS NULL;--> statement-breakpoint

-- Detached legacy rows are deterministic through client -> organization.
UPDATE "transactions" t
SET "currency_code" = upper(o."currency")
FROM "clients" c
JOIN "organizations" o ON o."id" = c."organization_id"
WHERE t."client_id" = c."id"
  AND t."currency_code" IS NULL;--> statement-breakpoint

ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
UPDATE "recurring_rules" r
SET "currency_code" = upper(wa."currency_code")
FROM "wealth_accounts" wa
WHERE r."wealth_account_id" = wa."id"
  AND r."currency_code" IS NULL;--> statement-breakpoint
UPDATE "recurring_rules" r
SET "currency_code" = upper(o."currency")
FROM "organizations" o
WHERE r."organization_id" = o."id"
  AND r."currency_code" IS NULL;--> statement-breakpoint

ALTER TABLE "spending_budgets" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
UPDATE "spending_budgets" b
SET "currency_code" = upper(o."currency")
FROM "organizations" o
WHERE b."organization_id" = o."id"
  AND b."currency_code" IS NULL;--> statement-breakpoint

ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_reporting_currency_check";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reporting_currency_check"
  CHECK ("reporting_currency" IS NULL OR "reporting_currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "wealth_accounts" DROP CONSTRAINT IF EXISTS "wealth_accounts_currency_code_check";--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD CONSTRAINT "wealth_accounts_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_currency_code_check";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "recurring_rules" DROP CONSTRAINT IF EXISTS "recurring_rules_currency_code_check";--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "spending_budgets" DROP CONSTRAINT IF EXISTS "spending_budgets_currency_code_check";--> statement-breakpoint
ALTER TABLE "spending_budgets" ADD CONSTRAINT "spending_budgets_currency_code_check"
  CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');
