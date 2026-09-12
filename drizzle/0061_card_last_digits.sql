-- Cards: store the last 4 TO 6 digits, not exactly 4.
--
-- The product asks for "the last 6 digits of the card". PCI DSS truncation
-- allows keeping at most the first six and last four, and a 4–6 digit tail is
-- still a truncated value that cannot be expanded back into a card number — it
-- only has to be enough for a person to tell two cards apart. The column keeps
-- its name (`last4`) so nothing else has to move; src/lib/cards.ts is the one
-- place that formats it (maskedTail / maskedNumber).
ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_last4_check";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_last4_check" CHECK (last4 ~ '^([0-9]{4,6})?$');
