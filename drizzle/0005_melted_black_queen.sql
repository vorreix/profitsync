ALTER TABLE "user_profiles" ADD COLUMN "company_upsell_dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "company_upsell_hidden" boolean DEFAULT false NOT NULL;