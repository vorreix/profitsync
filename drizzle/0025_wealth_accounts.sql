CREATE TABLE "wealth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"opening_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"current_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"icon" text DEFAULT 'bank' NOT NULL,
	"archived_at" timestamp,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD CONSTRAINT "wealth_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "wealth_accounts_org_idx" ON "wealth_accounts" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wealth_accounts_one_active_cash_idx" ON "wealth_accounts" USING btree ("organization_id") WHERE "type" = 'cash' AND "archived_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "wealth_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;
