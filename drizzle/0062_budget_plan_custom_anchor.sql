-- Budget v2 · two guards the engine already assumed.
--
-- 1. A custom cadence needs its anchor. Without one the period grid has
--    nothing to hang on: periodFor() used to re-anchor on the 1st of the
--    CURRENT month, producing overlapping, non-contiguous periods and a plan
--    that was permanently sync_required. The API refuses it; the DB does too.
ALTER TABLE "budget_plans" DROP CONSTRAINT IF EXISTS "budget_plans_custom_anchor_check";--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_custom_anchor_check"
  CHECK (cadence <> 'custom' OR (custom_start IS NOT NULL AND custom_days IS NOT NULL));--> statement-breakpoint
--
-- 2. A Space-backed fund keeps its Space. The FK was ON DELETE SET NULL, but
--    `budget_envelopes_space_backed_check` requires a Space while the mode is
--    space_backed — so deleting a Space that backed a fund raised the CHECK
--    (a 500), and an organisation teardown could trip over it depending on
--    cascade order. NO ACTION: a direct Space delete is refused by the FK
--    (the wealth route archives such a Space instead), while an org delete
--    still cascades cleanly because NO ACTION is checked at the END of the
--    statement, by which time the envelope rows are gone too.
ALTER TABLE "budget_envelopes" DROP CONSTRAINT IF EXISTS "budget_envelopes_wealth_account_id_wealth_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_wealth_account_id_wealth_accounts_id_fk"
  FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE no action ON UPDATE no action;
