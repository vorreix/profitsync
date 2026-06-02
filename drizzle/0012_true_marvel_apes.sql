-- Remove duplicate invoices for the same Dodo payment (created by a check-then-insert
-- race before the unique index existed), keeping the earliest row per payment id.
DELETE FROM "invoices" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "provider_invoice_id" ORDER BY "created_at", "id"
    ) AS rn
    FROM "invoices"
    WHERE "provider_invoice_id" IS NOT NULL
  ) t WHERE t.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_provider_invoice_id_key" ON "invoices" USING btree ("provider_invoice_id");
