-- Budgets, round 2 — the feedback on the first cut.
--
-- 1. `paused` becomes `closed`. The user's word for a budget they have put away
--    is "closed" (as clients are), and the page now folds those away behind a
--    "Closed" button instead of greying them in place.
-- 2. ONE overall budget per workspace. The overall budget is the top-level row
--    with no categories ("all spending"); it is the figure the page is built
--    around, and every other budget is compared against it — individually and
--    added up. Two of them would make that comparison meaningless. A CLOSED one
--    does not hold the slot, so putting one away and setting another works.
--
-- Both additive; every existing row is an active budget and no workspace has
-- two all-spending top-level budgets (verified before writing this).
UPDATE "spending_budgets" SET "status" = 'closed' WHERE "status" = 'paused';
--> statement-breakpoint
ALTER TABLE "spending_budgets" DROP CONSTRAINT IF EXISTS "spending_budgets_status_check";
--> statement-breakpoint
ALTER TABLE "spending_budgets" ADD CONSTRAINT "spending_budgets_status_check" CHECK (status in ('active','closed'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spending_budgets_overall_unique" ON "spending_budgets" USING btree ("organization_id") WHERE parent_id is null and categories = '[]'::jsonb and status = 'active';
