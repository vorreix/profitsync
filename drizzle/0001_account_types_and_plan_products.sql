ALTER TABLE "organizations" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "dodo_product_monthly" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "dodo_product_yearly" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "onboarded_at" timestamp;