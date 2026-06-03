CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("organization_id","entity_type","entity_id");