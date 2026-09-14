-- Pay a credit card from a bank, from cash, or FROM ANOTHER CARD.
--
-- `funding_account_id` keeps its meaning exactly: the account the money leaves.
-- `funding_card_id` is the optional INSTRUMENT on that side, and mirrors the
-- rule every transaction write already applies (api/_lib/cards.ts attributeCard):
-- when a card is named, the money must land on that card's own account. So the
-- pair is always consistent, and one server helper enforces it on every write.
--
--   debit card  -> the money still leaves its BANK; the card is a label, and the
--                  ledger reads "D 1234" on the outgoing leg
--   credit card -> a BALANCE TRANSFER: the payer card's liability account is the
--                  source, so its debt goes up as this card's goes down. Net
--                  worth does not move, because nothing was paid off.
--
-- The one hard rule, enforced on both write paths and again in the autopay
-- engine: AUTOPAY REQUIRES A BANK OR CASH. That single rule is also what makes
-- a funding-graph cycle impossible without walking the graph — a loop needs two
-- unattended payers, and a card can never be one.
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "funding_card_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_funding_card_id_cards_id_fk";--> statement-breakpoint
-- SET NULL, like funding_account_id: losing the card that paid this one must
-- never remove this card or the debt on it. It falls back to the plain account,
-- and to "choose a bank to pay from" when that goes too.
ALTER TABLE "cards" ADD CONSTRAINT "cards_funding_card_id_cards_id_fk" FOREIGN KEY ("funding_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_funding_card_idx" ON "cards" USING btree ("funding_card_id");--> statement-breakpoint
-- Same-row checks only. "funding_card_id resolves to funding_account_id" is
-- cross-row and lives in api/_lib/cards.ts resolveFunding().
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_funding_not_self_check";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_funding_not_self_check" CHECK (funding_card_id IS NULL OR funding_card_id <> id);--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_funding_account_not_self_check";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_funding_account_not_self_check" CHECK (funding_account_id IS NULL OR funding_account_id <> account_id);
