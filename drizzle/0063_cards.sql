-- Wealth & Cards: a first-class CARD entity (debit or credit) linked to a bank.
--
-- A card row is IDENTITY and ATTRIBUTION only — it never holds money. The
-- ledger account it posts to is `account_id`: a debit card's linked bank, or a
-- credit card's liability account (wealth_accounts.type='credit_card', whose
-- signed balance, limit and statements are unchanged — docs/credit-cards).
-- `card_id` on transactions / recurring rules records WHICH card paid, so lists
-- can show "C •••• 1234" without touching balances. Full design: docs/cards/CARDS.md.
CREATE TABLE IF NOT EXISTS "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"funding_account_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"holder_name" text DEFAULT '' NOT NULL,
	"network" text DEFAULT 'other' NOT NULL,
	"last4" text DEFAULT '' NOT NULL,
	"expiry_month" integer,
	"expiry_year" integer,
	"tier" text DEFAULT 'standard' NOT NULL,
	"design" jsonb,
	"brand_colors" jsonb,
	"brand_logo_url" text DEFAULT '' NOT NULL,
	"autopay" boolean DEFAULT false NOT NULL,
	"autopay_since" date,
	"status" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cards_kind_check" CHECK (kind in ('debit','credit')),
	CONSTRAINT "cards_status_check" CHECK (status in ('active','frozen','closed')),
	CONSTRAINT "cards_last4_check" CHECK (last4 ~ '^([0-9]{4})?$'),
	CONSTRAINT "cards_expiry_month_check" CHECK (expiry_month is null or (expiry_month between 1 and 12)),
	CONSTRAINT "cards_expiry_year_check" CHECK (expiry_year is null or (expiry_year between 2000 and 2100)),
	CONSTRAINT "cards_expiry_pair_check" CHECK ((expiry_month is null) = (expiry_year is null)),
	CONSTRAINT "cards_tier_check" CHECK (tier in ('standard','gold','platinum','metal','black','custom'))
);--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_account_id_wealth_accounts_id_fk";--> statement-breakpoint
-- The ledger account is the card's home: removing it removes the card (a
-- liability account IS the credit card; a bank hard-delete only happens with no
-- transactions, so nothing that carries attribution is lost).
ALTER TABLE "cards" ADD CONSTRAINT "cards_account_id_wealth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_funding_account_id_wealth_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_funding_account_id_wealth_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_org_idx" ON "cards" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_account_idx" ON "cards" USING btree ("account_id");--> statement-breakpoint
-- One credit card per liability account (the card is the account's identity).
CREATE UNIQUE INDEX IF NOT EXISTS "cards_credit_account_unique" ON "cards" USING btree ("account_id") WHERE kind = 'credit';--> statement-breakpoint
-- Which card paid. SET NULL so deleting a card keeps the money history intact.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "card_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_card_id_cards_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_card_idx" ON "transactions" USING btree ("card_id");--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "card_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_rules" DROP CONSTRAINT IF EXISTS "recurring_rules_card_id_cards_id_fk";--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Autopay bookkeeping on the statement it paid. `autopay_status` is a small
-- state machine (api/_lib/card-autopay.ts): NULL → 'processing' (the CLAIM, a
-- single conditional UPDATE, the only idempotency gate Neon HTTP allows) →
-- 'paid' (written in the SAME batch as the transfer legs) | 'failed' (the batch
-- errored, or a claim went stale — never retried automatically; `autopay_error`
-- says why) | 'skipped' (nothing left to pay / superseded by a newer statement).
-- The transfer's group_id lets the UI link to the payment.
ALTER TABLE "credit_card_statements" ADD COLUMN IF NOT EXISTS "autopay_status" text;--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD COLUMN IF NOT EXISTS "autopay_group_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD COLUMN IF NOT EXISTS "autopay_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD COLUMN IF NOT EXISTS "autopay_error" text;--> statement-breakpoint
ALTER TABLE "credit_card_statements" DROP CONSTRAINT IF EXISTS "credit_card_statements_autopay_status_check";--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD CONSTRAINT "credit_card_statements_autopay_status_check" CHECK (autopay_status is null or autopay_status in ('processing','paid','skipped','failed'));--> statement-breakpoint
-- Backfill: every existing credit-card account becomes a credit CARD so the new
-- Cards tab shows it. Identity fields are unknown (empty) until the user edits.
INSERT INTO "cards" ("organization_id", "kind", "account_id", "name", "network", "status", "position", "created_by", "updated_by", "created_at")
SELECT
	wa."organization_id",
	'credit',
	wa."id",
	wa."nickname",
	CASE
		WHEN wa."nickname" ~* 'visa' OR wa."bank_name" ~* 'visa' THEN 'visa'
		WHEN wa."nickname" ~* 'master' OR wa."bank_name" ~* 'master' THEN 'mastercard'
		WHEN wa."nickname" ~* 'amex|american express' OR wa."bank_name" ~* 'amex|american express' THEN 'amex'
		WHEN wa."nickname" ~* 'rupay' OR wa."bank_name" ~* 'rupay' THEN 'rupay'
		ELSE 'other'
	END,
	CASE WHEN wa."archived_at" IS NULL THEN 'active' ELSE 'closed' END,
	wa."position",
	wa."created_by",
	wa."updated_by",
	coalesce(wa."created_at", now())
FROM "wealth_accounts" wa
WHERE wa."type" = 'credit_card'
	AND NOT EXISTS (SELECT 1 FROM "cards" c WHERE c."account_id" = wa."id" AND c."kind" = 'credit');--> statement-breakpoint
-- Invariant: every row on a liability account carries that account's credit
-- card (the card IS the account's identity, 1:1) — so the chip is on every
-- purchase, payment and fee that already exists, not only on new ones. The
-- server derives it the same way on every later write (api/_lib/cards.ts).
UPDATE "transactions" t SET "card_id" = c."id" FROM "cards" c WHERE c."kind" = 'credit' AND c."account_id" = t."wealth_account_id" AND t."card_id" IS NULL;--> statement-breakpoint
UPDATE "recurring_rules" r SET "card_id" = c."id" FROM "cards" c WHERE c."kind" = 'credit' AND c."account_id" = r."wealth_account_id" AND r."card_id" IS NULL;
