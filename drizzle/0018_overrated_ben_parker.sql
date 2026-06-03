ALTER TABLE "clients" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "category" text DEFAULT '' NOT NULL;