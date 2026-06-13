CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"wealth_account_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"frequency_unit" text NOT NULL,
	"frequency_interval" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_due_at" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_due_date" date;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_rules_due_idx" ON "recurring_rules" USING btree ("organization_id","active","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurring_once_idx" ON "transactions" USING btree ("recurring_rule_id","recurring_due_date");