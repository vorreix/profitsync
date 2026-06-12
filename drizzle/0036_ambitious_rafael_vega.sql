ALTER TABLE "organizations" ADD COLUMN "logo_data" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_mime" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "avatar_data" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "avatar_mime" text DEFAULT '' NOT NULL;