-- The logical transfer above the two ledger legs.
--
-- Foreign-key actions: a transfer belongs to its two accounts, so it CASCADES
-- with them (the same choice the debts tables make). RESTRICT here would make
-- api/_lib/account-reset.ts fail: the factory reset deletes wealth_accounts
-- directly, while transfers only cascade from the organization. A leg's link
-- to its header is SET NULL on header deletion so no teardown order can be
-- blocked by it; the legs then read as the legacy two-row shape.
CREATE TABLE IF NOT EXISTS "transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "group_id" uuid NOT NULL,
  "source_account_id" uuid NOT NULL REFERENCES "wealth_accounts"("id") ON DELETE cascade,
  "destination_account_id" uuid NOT NULL REFERENCES "wealth_accounts"("id") ON DELETE cascade,
  "source_amount" numeric(20,4) NOT NULL,
  "source_currency" text NOT NULL,
  "destination_amount" numeric(20,4) NOT NULL,
  "destination_currency" text NOT NULL,
  "effective_rate" numeric(30,14),
  "status" text DEFAULT 'completed' NOT NULL,
  "transfer_date" date NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "reverses_transfer_id" uuid REFERENCES "transfers"("id") ON DELETE set null,
  "completed_at" timestamp,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "transfers_accounts_check" CHECK (source_account_id <> destination_account_id),
  CONSTRAINT "transfers_amounts_check" CHECK (source_amount > 0 AND destination_amount > 0),
  CONSTRAINT "transfers_status_check" CHECK (status in ('planned','pending','completed','cancelled')),
  CONSTRAINT "transfers_rate_check" CHECK (effective_rate IS NULL OR effective_rate > 0),
  CONSTRAINT "transfers_currency_check" CHECK (source_currency ~ '^[A-Z]{3}$' AND destination_currency ~ '^[A-Z]{3}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transfers_group_unique" ON "transfers" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_org_date_idx" ON "transfers" ("organization_id", "transfer_date");--> statement-breakpoint

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_transfer_id_transfers_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_id_transfers_id_fk"
  FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_transfer_idx" ON "transactions" ("transfer_id");--> statement-breakpoint

-- Legacy backfill: only unambiguous two-leg, same-date, same-amount,
-- same-currency groups become headers. Anything else stays as it is, for audit.
WITH deterministic AS (
  SELECT t."group_id", c."organization_id",
    (array_agg(t."wealth_account_id" ORDER BY t."id") FILTER (WHERE t."type" = 'outgoing'))[1] AS source_account_id,
    (array_agg(t."wealth_account_id" ORDER BY t."id") FILTER (WHERE t."type" = 'incoming'))[1] AS destination_account_id,
    max(t."amount") AS amount, max(t."currency_code") AS currency_code,
    max(t."date") AS transfer_date, max(t."created_by") AS created_by,
    max(t."created_at") AS completed_at
  FROM "transactions" t JOIN "clients" c ON c."id" = t."client_id"
  WHERE t."kind" = 'transfer' AND t."group_id" IS NOT NULL
  GROUP BY t."group_id", c."organization_id"
  HAVING count(*) = 2
    AND count(*) FILTER (WHERE t."type" = 'outgoing') = 1
    AND count(*) FILTER (WHERE t."type" = 'incoming') = 1
    AND count(DISTINCT t."amount") = 1
    AND count(DISTINCT t."date") = 1
    AND count(DISTINCT t."currency_code") = 1
    AND count(t."wealth_account_id") = 2
)
INSERT INTO "transfers" ("organization_id", "group_id", "source_account_id", "destination_account_id", "source_amount", "source_currency", "destination_amount", "destination_currency", "status", "transfer_date", "completed_at", "created_by")
SELECT organization_id, group_id, source_account_id, destination_account_id, amount, currency_code, amount, currency_code, 'completed', transfer_date, completed_at, created_by
FROM deterministic WHERE source_account_id <> destination_account_id
ON CONFLICT ("group_id") DO NOTHING;--> statement-breakpoint

UPDATE "transactions" t SET "transfer_id" = x."id"
FROM "transfers" x
WHERE t."group_id" = x."group_id" AND t."kind" = 'transfer' AND t."transfer_id" IS NULL;
