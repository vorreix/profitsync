import type { Card } from "@/lib/types"

/**
 * The three relationships a card can have with a money account — never mixed,
 * because they are not the same thing:
 *  • `on`     — the card IS this account's money (a debit card on the bank), so
 *               every purchase leaves this balance;
 *  • `pays`   — this account merely SETTLES that credit card's statement. The
 *               card is its own liability account and what it owes is NOT part
 *               of this balance;
 *  • `issued` — this bank GAVE you that credit card, but something else pays
 *               it. No money moves between the two at all; the card is here
 *               because it is the bank's card and people look for it here.
 *
 * A card appears in exactly ONE group, most-involved first: a card that is both
 * issued and paid by this account is listed under `pays`, because that is the
 * relationship that actually moves money.
 *
 * Open cards first, closed ones last (they are kept only for their history).
 */
export function relatedBankCards(cards: Card[], accountId: string): { on: Card[]; pays: Card[]; issued: Card[] } {
  const order = (c: Card) => (c.status === "closed" ? 1 : 0)
  const sort = (list: Card[]) => [...list].sort((a, b) => order(a) - order(b))
  return {
    on: sort(cards.filter((c) => c.kind === "debit" && c.account_id === accountId)),
    pays: sort(cards.filter((c) => c.kind === "credit" && c.funding_account_id === accountId)),
    issued: sort(
      cards.filter((c) => c.kind === "credit" && c.issuer_account_id === accountId && c.funding_account_id !== accountId),
    ),
  }
}
