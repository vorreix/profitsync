ALTER TABLE "quotations" ADD COLUMN "pdf_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "pdf_object_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "pdf_source_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "pdf_size_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "pdf_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "pdf_error" text DEFAULT '' NOT NULL;