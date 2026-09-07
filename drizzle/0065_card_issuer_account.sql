-- The bank that ISSUED a credit card becomes a real account, not free text.
--
-- Until now a credit card's issuer lived only as `bank_name` on its own
-- liability account — a string with no link to the user's banks. That is why a
-- card branded "Intesa Sanpaolo" was invisible on the Intesa bank page: the
-- page can only match rows, and there was no row to match.
--
-- `issuer_account_id` is the third (and last) account a card can point at:
--   account_id          — the ledger it posts to (debit: the bank; credit: its
--                         own liability account)
--   funding_account_id  — credit only: the bank that pays the statement
--   issuer_account_id   — credit only: the bank that gave you the card
-- The last two are usually the same bank, but not always: an HDFC card can be
-- paid from an ICICI account, and both facts are worth keeping.
--
-- NULL stays valid forever: every card created before this migration (and any
-- created by an older client) simply has no issuer account, and every surface
-- falls back to the liability account's bank_name exactly as it does today.
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "issuer_account_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_issuer_account_id_wealth_accounts_id_fk";--> statement-breakpoint
-- SET NULL, not cascade: deleting the issuing bank must never delete the card
-- or the debt on it. The card keeps its own branding and simply stops naming a
-- bank row, which is exactly the pre-migration state.
ALTER TABLE "cards" ADD CONSTRAINT "cards_issuer_account_id_wealth_accounts_id_fk" FOREIGN KEY ("issuer_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_issuer_account_idx" ON "cards" USING btree ("issuer_account_id");--> statement-breakpoint
-- Conservative backfill: only where the funding bank IS demonstrably the
-- issuer — same organisation, and its name matches the card's own branding.
-- Anything less certain is left NULL rather than inventing a relationship the
-- user never stated.
UPDATE "cards" c SET "issuer_account_id" = f."id" FROM "wealth_accounts" f, "wealth_accounts" l WHERE c."kind" = 'credit' AND c."issuer_account_id" IS NULL AND c."funding_account_id" = f."id" AND c."account_id" = l."id" AND f."type" = 'bank' AND f."organization_id" = c."organization_id" AND lower(btrim(coalesce(f."bank_name", ''))) = lower(btrim(coalesce(l."bank_name", ''))) AND btrim(coalesce(l."bank_name", '')) <> '';
