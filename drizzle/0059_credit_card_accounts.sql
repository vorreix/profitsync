-- Credit-card (liability) accounts.
--
-- wealth_accounts gains the card CONFIGURATION only (limit + fixed closing/due
-- days). Everything the card screen shows — amount owed, available credit,
-- statement remaining, new-cycle spend — is derived from the ledger and the
-- statements table (src/lib/credit-card.ts), so no stored figure can drift.
-- Existing bank/cash/space rows keep NULLs and are never reinterpreted.
ALTER TABLE "wealth_accounts" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(20, 2);--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN IF NOT EXISTS "statement_closing_day" integer;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN IF NOT EXISTS "payment_due_day" integer;--> statement-breakpoint
ALTER TABLE "wealth_accounts" DROP CONSTRAINT IF EXISTS "wealth_accounts_closing_day_check";--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD CONSTRAINT "wealth_accounts_closing_day_check" CHECK (statement_closing_day is null or (statement_closing_day between 1 and 31));--> statement-breakpoint
ALTER TABLE "wealth_accounts" DROP CONSTRAINT IF EXISTS "wealth_accounts_due_day_check";--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD CONSTRAINT "wealth_accounts_due_day_check" CHECK (payment_due_day is null or (payment_due_day between 1 and 31));--> statement-breakpoint
-- One row per CLOSED billing cycle: a snapshot of the amount owed at the end of
-- the closing date. Payments are derived from the ledger, never stored here.
-- Cascades with the account, so an account/org delete or a factory reset leaves
-- no orphaned statements.
CREATE TABLE IF NOT EXISTS "credit_card_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"wealth_account_id" uuid NOT NULL,
	"cycle_start" date,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"statement_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"source" text DEFAULT 'computed' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_statements_source_check" CHECK (source in ('computed','manual'))
);--> statement-breakpoint
ALTER TABLE "credit_card_statements" DROP CONSTRAINT IF EXISTS "credit_card_statements_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD CONSTRAINT "credit_card_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_statements" DROP CONSTRAINT IF EXISTS "credit_card_statements_wealth_account_id_wealth_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD CONSTRAINT "credit_card_statements_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_card_statements_account_close_unique" ON "credit_card_statements" USING btree ("wealth_account_id","closing_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_card_statements_org_idx" ON "credit_card_statements" USING btree ("organization_id");
