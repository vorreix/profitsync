ALTER TABLE "plans" ADD COLUMN "dodo_environment" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dodo_environment" text;