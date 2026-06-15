ALTER TABLE "transactions" ADD COLUMN "family_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "family_party_user_id" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "family_org_id" uuid;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_family_org_id_organizations_id_fk" FOREIGN KEY ("family_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;