-- Budget v2 · the budgets LIST (docs/budget-v2/SIMPLE.md).
--
-- A budget line can now be a `group` — a macro budget (Household) whose figures
-- are the SUM of the categories inside it — and a category can sit inside one
-- group (`parent_id`). One level only. A line can also be `hidden` (display
-- only: still counted, folded away on the page). "Inactive" reuses the existing
-- `status = 'paused'`, which the engine now gives semantics: no claimed
-- categories, no planned amount, out of every total.
--
-- All additive; every existing row is an ungrouped, visible category.
ALTER TABLE "budget_envelopes" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'category';--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD COLUMN IF NOT EXISTS "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD COLUMN IF NOT EXISTS "hidden" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "budget_envelopes" DROP CONSTRAINT IF EXISTS "budget_envelopes_parent_id_budget_envelopes_id_fk";--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_parent_id_budget_envelopes_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."budget_envelopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_envelopes_parent_idx" ON "budget_envelopes" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "budget_envelopes" DROP CONSTRAINT IF EXISTS "budget_envelopes_kind_check";--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_kind_check" CHECK (kind in ('category','group'));--> statement-breakpoint
-- One level: a group never sits inside another group.
ALTER TABLE "budget_envelopes" DROP CONSTRAINT IF EXISTS "budget_envelopes_group_flat_check";--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_group_flat_check" CHECK (kind <> 'group' or parent_id is null);--> statement-breakpoint
-- A group is a spending construct; the other sections have no list to group.
ALTER TABLE "budget_envelopes" DROP CONSTRAINT IF EXISTS "budget_envelopes_group_section_check";--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_group_section_check" CHECK (kind <> 'group' or section = 'flexible');--> statement-breakpoint
-- The catch-all is the plan's ceiling (§8.5); it stays at the top level so it
-- can never be silenced by deactivating a group.
ALTER TABLE "budget_envelopes" DROP CONSTRAINT IF EXISTS "budget_envelopes_catch_all_ungrouped_check";--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_catch_all_ungrouped_check" CHECK (not is_catch_all or parent_id is null);
