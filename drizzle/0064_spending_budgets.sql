-- Budgets v3 — one simple model in place of the v2 engine.
--
-- 1. `spending_budgets`: a named limit over a window, scoped to expense
--    categories (or all spending), with one level of sub-budgets. Spend is
--    never stored; api/_lib/spending-budgets.ts sums it live.
-- 2. A personal workspace's v1 org-level `budgets` row becomes its first
--    spending budget (lifetime → once with no bounds) and the v1 row goes, so
--    there is one source of truth. Business per-client caps are untouched.
-- 3. The v2 engine's migrations (0059–0061) were RETIRED from the journal
--    rather than kept: production never ran them (its last applied migration
--    is 0058, and the neon-http migrator records nothing until a whole pending
--    batch succeeds — a failure anywhere after a plain CREATE TABLE would have
--    wedged every later deploy on "relation already exists"), so production
--    never gets those tables at all. The shared dev DB, which did run them, is
--    gated on created_at and keeps them as orphans for now — a teammate's
--    branch still reads them; drop them in a one-line follow-up once that
--    branch is closed. This file owns the one thing worth keeping from them:
--    the category-key index, which recentFor/seriesFor match on.
--
-- "Personal" is `organizations.account_type = 'personal'` — what the v1 route's
-- isPersonalAccount() decided by, not the is_personal auto-org flag (the two
-- diverge for demoted duplicates). Any other account type (business, family)
-- keeps its rows as business-style per-client caps.
CREATE TABLE IF NOT EXISTS "spending_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"start_date" date,
	"end_date" date,
	"amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "spending_budgets_period_check" CHECK (period in ('daily','weekly','monthly','yearly','once')),
	CONSTRAINT "spending_budgets_status_check" CHECK (status in ('active','paused')),
	CONSTRAINT "spending_budgets_amount_check" CHECK (amount >= 0),
	CONSTRAINT "spending_budgets_dates_once_check" CHECK (period = 'once' or (start_date is null and end_date is null)),
	CONSTRAINT "spending_budgets_date_order_check" CHECK (start_date is null or end_date is null or end_date >= start_date),
	CONSTRAINT "spending_budgets_child_dates_check" CHECK (parent_id is null or (start_date is null and end_date is null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spending_budgets" ADD CONSTRAINT "spending_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spending_budgets" ADD CONSTRAINT "spending_budgets_parent_id_spending_budgets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."spending_budgets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spending_budgets_org_idx" ON "spending_budgets" USING btree ("organization_id","parent_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spending_budgets_sibling_name_unique" ON "spending_budgets" USING btree ("organization_id",coalesce("parent_id","organization_id"),lower("name"));
--> statement-breakpoint
-- A personal workspace's single v1 budget becomes its first spending budget.
INSERT INTO "spending_budgets" ("organization_id", "name", "period", "amount", "categories", "created_by", "updated_by", "created_at", "updated_at")
SELECT b."organization_id", '', CASE b."period" WHEN 'lifetime' THEN 'once' ELSE b."period" END, b."amount", '[]'::jsonb, b."created_by", b."updated_by", coalesce(b."created_at", now()), coalesce(b."updated_at", now())
FROM "budgets" b JOIN "organizations" o ON o."id" = b."organization_id"
WHERE b."client_id" IS NULL AND o."account_type" = 'personal' AND b."amount" > 0
  AND NOT EXISTS (SELECT 1 FROM "spending_budgets" s WHERE s."organization_id" = b."organization_id" AND s."parent_id" IS NULL AND s."name" = '');
--> statement-breakpoint
-- …and keeps its change history: the v1 rows become the new budget's audit
-- trail, which is what the detail page's "Changes" and the chart's per-window
-- limit read from.
INSERT INTO "audit_logs" ("organization_id", "entity_type", "entity_id", "action", "actor_user_id", "changes", "created_at")
SELECT h."organization_id", 'budget', s."id",
  CASE h."action" WHEN 'set' THEN 'create' WHEN 'remove' THEN 'delete' ELSE 'update' END,
  h."changed_by",
  jsonb_build_object(
    'amount', jsonb_build_object('from', lag(h."amount") OVER (PARTITION BY h."organization_id" ORDER BY h."created_at"), 'to', h."amount"),
    'period', jsonb_build_object('from', lag(h."period") OVER (PARTITION BY h."organization_id" ORDER BY h."created_at"), 'to', h."period")
  ),
  coalesce(h."created_at", now())
FROM "budget_history" h
JOIN "organizations" o ON o."id" = h."organization_id" AND o."account_type" = 'personal'
JOIN "spending_budgets" s ON s."organization_id" = h."organization_id" AND s."parent_id" IS NULL AND s."name" = ''
WHERE h."client_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "audit_logs" a WHERE a."entity_type" = 'budget' AND a."entity_id" = s."id");
--> statement-breakpoint
DELETE FROM "budget_history" h USING "organizations" o WHERE o."id" = h."organization_id" AND h."client_id" IS NULL AND o."account_type" = 'personal';
--> statement-breakpoint
DELETE FROM "budgets" b USING "organizations" o WHERE o."id" = b."organization_id" AND b."client_id" IS NULL AND o."account_type" = 'personal';
--> statement-breakpoint
-- Spending budgets match rows on the NORMALISED category key, so "Groceries",
-- "groceries" and " Groceries " are one category; this makes the WHERE-level
-- matches (a budget's recent rows, its history chart) index scans.
CREATE INDEX IF NOT EXISTS "transactions_category_key_idx" ON "transactions" USING btree ("client_id", (lower(btrim(coalesce("category", '')))));
