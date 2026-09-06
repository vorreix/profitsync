import type { Card } from "@/lib/types"

/**
 * The two relationships a card can have with a money account — never mixed,
 * because they are not the same thing:
 *  • `on`   — the card IS this account's money (a debit card on the bank), so
 *             every purchase leaves this balance;
 *  • `pays` — this account merely SETTLES that credit card's statement. The
 *             card is its own liability account and what it owes is NOT part of
 *             this balance.
 *
 * Open cards first, closed ones last (they are kept only for their history).
 */
export function relatedBankCards(cards: Card[], accountId: string): { on: Card[]; pays: Card[] } {
  const order = (c: Card) => (c.status === "closed" ? 1 : 0)
  const sort = (list: Card[]) => [...list].sort((a, b) => order(a) - order(b))
  return {
    on: sort(cards.filter((c) => c.kind === "debit" && c.account_id === accountId)),
    pays: sort(cards.filter((c) => c.kind === "credit" && c.funding_account_id === accountId)),
  }
}
