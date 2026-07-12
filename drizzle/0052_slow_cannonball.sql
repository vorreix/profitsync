CREATE TABLE "quotation_pdfs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"organization_id" uuid,
	"object_key" text DEFAULT '' NOT NULL,
	"source_hash" text DEFAULT '' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"generated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "quotation_pdfs" ADD CONSTRAINT "quotation_pdfs_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotation_pdfs_quotation_idx" ON "quotation_pdfs" USING btree ("quotation_id");--> statement-breakpoint
-- Backfill: existing ready PDFs (single-value quotations.pdf_* columns) become the
-- first history entry, so no already-generated PDF is lost when the app switches to
-- reading from quotation_pdfs. Idempotent enough for a one-shot migration.
INSERT INTO "quotation_pdfs" ("quotation_id", "organization_id", "object_key", "source_hash", "size_bytes", "status", "generated_at", "created_at")
SELECT "id", "organization_id", "pdf_object_key", "pdf_source_hash", "pdf_size_bytes", 'ready', "pdf_generated_at", COALESCE("pdf_generated_at", now())
FROM "quotations"
WHERE "pdf_status" = 'ready' AND "pdf_object_key" <> '' AND "deleted_at" IS NULL;