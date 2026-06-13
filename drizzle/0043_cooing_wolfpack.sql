ALTER TABLE "recurring_rules" ADD COLUMN "kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "to_account_id" uuid;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "goal_amount" numeric(20, 2);--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "target_date" date;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_to_account_id_wealth_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;