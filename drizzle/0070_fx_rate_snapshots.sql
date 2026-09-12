-- Immutable market-rate observations. Vendors receive only a currency pair and
-- a date; conversion happens inside ProfitSync. Actual transfer rates live on
-- the logical transfer (0071/0072), never here.
CREATE TABLE IF NOT EXISTS "fx_rate_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_currency" text NOT NULL,
  "quote_currency" text NOT NULL,
  "rate" numeric(30,14) NOT NULL,
  "rate_date" date NOT NULL,
  "provider" text NOT NULL,
  "source_type" text NOT NULL,
  "is_fallback" boolean DEFAULT false NOT NULL,
  "observed_at" timestamp NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "fx_rate_snapshots_pair_check" CHECK (base_currency <> quote_currency),
  CONSTRAINT "fx_rate_snapshots_rate_check" CHECK (rate > 0),
  CONSTRAINT "fx_rate_snapshots_source_check" CHECK (source_type in ('market','historical_market','manual')),
  CONSTRAINT "fx_rate_snapshots_currency_check" CHECK (
    base_currency ~ '^[A-Z]{3}$' AND quote_currency ~ '^[A-Z]{3}$'
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fx_rate_snapshots_pair_date_idx"
  ON "fx_rate_snapshots" ("base_currency", "quote_currency", "rate_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fx_rate_snapshots_observation_unique"
  ON "fx_rate_snapshots" ("base_currency", "quote_currency", "rate_date", "provider", "source_type");
