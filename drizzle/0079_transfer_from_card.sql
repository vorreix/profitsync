-- A planned/pending transfer remembers the card it was planned with.
--
-- An immediate transfer puts `from_card_id` straight onto its outgoing leg.
-- A planned or pending one posts no leg until it is marked done — and the
-- header had nowhere to keep the card, so completing it later posted the
-- outgoing leg with no card: "paid with D •••• 1234" was silently lost (MC-147).
-- complete_transfer (0073) already takes the out-leg card as a parameter; the
-- completion path now passes this column.
--
-- SET NULL like transactions.card_id (0060): deleting a card never deletes or
-- blocks a transfer; the completion then falls back to no debit card.
--
-- Additive and re-runnable: a nullable column, its constraint dropped before it
-- is added, every statement separated by a statement-breakpoint marker.

ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "from_card_id" uuid;--> statement-breakpoint
ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_from_card_id_cards_id_fk";--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_card_id_cards_id_fk" FOREIGN KEY ("from_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;
