ALTER TABLE "user_profiles" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "state" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "postal_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "phone_country_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "phone" text DEFAULT '' NOT NULL;