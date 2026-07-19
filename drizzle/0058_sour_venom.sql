CREATE TABLE "ai_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"transcript" text DEFAULT '' NOT NULL,
	"intent" text DEFAULT 'unknown' NOT NULL,
	"say" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ai_asks" ADD CONSTRAINT "ai_asks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_asks_org_user_idx" ON "ai_asks" USING btree ("organization_id","user_id","created_at");