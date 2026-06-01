ALTER TABLE "clients" ADD COLUMN "is_own" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "promo_note" text DEFAULT '' NOT NULL;