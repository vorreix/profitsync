CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"period" text DEFAULT 'monthly' NOT NULL,
	"amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_org_idx" ON "budgets" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_org_client_unique" ON "budgets" USING btree ("organization_id","client_id") WHERE client_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_org_default_unique" ON "budgets" USING btree ("organization_id") WHERE client_id IS NULL;