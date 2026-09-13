-- Recurring repayments for Debt & Loans.
--
-- A debt repayment is not an ordinary recurring expense and not a Space
-- auto-save: it splits into a PRINCIPAL transfer (bank -> debt, never spending)
-- and INTEREST/FEE expenses on the paying account, and it has to write the
-- allocation row that makes that split visible. So the rule carries a third
-- kind, 'debt', and points at the debt account it repays.
--
-- `debt_account_id` cascades with the debt: a rule that repays a debt has no
-- meaning once the debt is gone, unlike `wealth_account_id`/`to_account_id`
-- (ON DELETE SET NULL), which name accounts a rule can simply be re-pointed at.
ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "debt_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "recurring_rules" DROP CONSTRAINT IF EXISTS "recurring_rules_debt_account_id_wealth_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_debt_account_id_wealth_accounts_id_fk" FOREIGN KEY ("debt_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_rules_debt_idx" ON "recurring_rules" ("debt_account_id");
