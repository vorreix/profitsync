CREATE TABLE "ai_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"free_granted" boolean DEFAULT false NOT NULL,
	"premium_period" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ai_credits" ADD CONSTRAINT "ai_credits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credits_org_unique" ON "ai_credits" USING btree ("organization_id");