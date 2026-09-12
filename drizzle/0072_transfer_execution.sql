-- Transfer execution facts: rate provenance, the source-side fee, and the
-- same-currency principal equality check.
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "rate_source" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "source_fee_amount" numeric(20,4) DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_fee_check";--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fee_check"
  CHECK (source_fee_amount >= 0);--> statement-breakpoint
ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_same_currency_amount_check";--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_same_currency_amount_check"
  CHECK (source_currency <> destination_currency OR source_amount = destination_amount);--> statement-breakpoint
ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_rate_source_check";--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_rate_source_check"
  CHECK (rate_source IS NULL OR rate_source IN ('effective_transfer', 'fixed_rate', 'provider'));--> statement-breakpoint

UPDATE "transfers"
SET "rate_source" = 'effective_transfer'
WHERE "source_currency" <> "destination_currency" AND "effective_rate" IS NOT NULL AND "rate_source" IS NULL;
