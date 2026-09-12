-- Debt & Loans.
--
-- A debt IS a wealth account (type 'loan' = I owe, 'receivable' = owed to me):
-- its balance lives in wealth_accounts.current_balance and moves through the
-- ordinary ledger. These two tables hold only the TERMS and the per-payment
-- allocation (principal / interest / fees). Both cascade with the account, so an
-- account delete, an org teardown or a factory reset leaves nothing behind.
-- Existing rows of every other type are untouched; nothing is reinterpreted.
CREATE TABLE IF NOT EXISTS "debt_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"wealth_account_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"counterparty" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"original_amount" numeric(20, 2),
	"annual_rate_pct" numeric(8, 4),
	"rate_type" text,
	"payment_amount" numeric(20, 2),
	"payment_frequency" text,
	"next_due_date" date,
	"start_date" date,
	"maturity_date" date,
	"remaining_installments" integer,
	"balance_is_estimate" boolean DEFAULT false NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"refinanced_into_account_id" uuid,
	"closed_at" timestamp,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "debt_details_lifecycle_check" CHECK (lifecycle in ('active','paused','paid_off','refinanced','written_off')),
	CONSTRAINT "debt_details_frequency_check" CHECK (payment_frequency is null or payment_frequency in ('weekly','biweekly','monthly','quarterly','yearly','irregular'))
);--> statement-breakpoint
ALTER TABLE "debt_details" DROP CONSTRAINT IF EXISTS "debt_details_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "debt_details" ADD CONSTRAINT "debt_details_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_details" DROP CONSTRAINT IF EXISTS "debt_details_wealth_account_id_wealth_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "debt_details" ADD CONSTRAINT "debt_details_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_details" DROP CONSTRAINT IF EXISTS "debt_details_refinanced_into_account_id_wealth_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "debt_details" ADD CONSTRAINT "debt_details_refinanced_into_account_id_wealth_accounts_id_fk" FOREIGN KEY ("refinanced_into_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "debt_details_account_unique" ON "debt_details" USING btree ("wealth_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "debt_details_org_idx" ON "debt_details" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "debt_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"wealth_account_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"group_id" uuid,
	"date" date NOT NULL,
	"total" numeric(20, 2) NOT NULL,
	"principal" numeric(20, 2) DEFAULT '0' NOT NULL,
	"interest" numeric(20, 2) DEFAULT '0' NOT NULL,
	"fees" numeric(20, 2) DEFAULT '0' NOT NULL,
	"other" numeric(20, 2) DEFAULT '0' NOT NULL,
	"split_source" text DEFAULT 'entered' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "debt_payments_split_check" CHECK (split_source in ('entered','calculated','principal_only'))
);--> statement-breakpoint
ALTER TABLE "debt_payments" DROP CONSTRAINT IF EXISTS "debt_payments_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" DROP CONSTRAINT IF EXISTS "debt_payments_wealth_account_id_wealth_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" DROP CONSTRAINT IF EXISTS "debt_payments_transaction_id_transactions_id_fk";--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "debt_payments_account_date_idx" ON "debt_payments" USING btree ("wealth_account_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "debt_payments_org_idx" ON "debt_payments" USING btree ("organization_id");
