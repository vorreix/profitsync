-- Budget v2 · Phase 2
--   1. transaction_settlements  (spec §10.11 — explicit, partial-capable expense↔refund links)
--   2. the functional index on transactions (lower(btrim(category)))  (spec §17.2, decision D-4)
--
-- Deliberately additive: no DROP, no ALTER of any Maqbool-owned column. The
-- category index is the ONE change that touches an existing shared table, and
-- it is an index only — it cannot alter a row or a constraint.

CREATE TABLE IF NOT EXISTS "transaction_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"expense_transaction_id" uuid NOT NULL,
	"settlement_transaction_id" uuid NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"kind" text DEFAULT 'refund' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_settlements_amount_check" CHECK (amount > 0),
	CONSTRAINT "transaction_settlements_kind_check" CHECK (kind in ('refund','reimbursement','chargeback')),
	CONSTRAINT "transaction_settlements_distinct_check" CHECK (expense_transaction_id <> settlement_transaction_id)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_settlements" ADD CONSTRAINT "transaction_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_settlements" ADD CONSTRAINT "transaction_settlements_expense_transaction_id_transactions_id_fk" FOREIGN KEY ("expense_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_settlements" ADD CONSTRAINT "transaction_settlements_settlement_transaction_id_transactions_id_fk" FOREIGN KEY ("settlement_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_settlements_pair_unique" ON "transaction_settlements" USING btree ("expense_transaction_id","settlement_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_settlements_expense_idx" ON "transaction_settlements" USING btree ("organization_id","expense_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_settlements_settlement_idx" ON "transaction_settlements" USING btree ("settlement_transaction_id");
--> statement-breakpoint
-- Budget v2 matches spend to envelopes on the NORMALISED category key
-- (lower(btrim(category))) so "Groceries", "groceries" and " Groceries " are one
-- category. Without this functional index every envelope query is a seq scan on
-- transactions; with it the per-plan grouped query is an index scan.
CREATE INDEX IF NOT EXISTS "transactions_category_key_idx" ON "transactions" USING btree ("client_id", (lower(btrim(coalesce("category", '')))));
