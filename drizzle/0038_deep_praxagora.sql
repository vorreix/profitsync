CREATE TABLE "billing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"owner_email" text DEFAULT '' NOT NULL,
	"organization_name" text DEFAULT '' NOT NULL,
	"plan_key" text NOT NULL,
	"billing_cycle" text,
	"currency" text,
	"provider" text DEFAULT 'dodo' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"dodo_subscription_id" text,
	"dodo_payment_id" text,
	"provider_error_message" text DEFAULT '' NOT NULL,
	"webhook_error_details" jsonb,
	"follow_up_status" text DEFAULT 'none' NOT NULL,
	"follow_up_notes" text DEFAULT '' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "billing_attempts" ADD CONSTRAINT "billing_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_attempts_org_created_idx" ON "billing_attempts" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_attempts_status_created_idx" ON "billing_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "billing_attempts_dodo_sub_idx" ON "billing_attempts" USING btree ("dodo_subscription_id");