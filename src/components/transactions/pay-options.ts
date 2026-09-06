// What a user can PAY WITH, as one list: accounts (cash, banks, …) and cards.
// Shared by the transaction form's AccountSelector and the AccountCombobox
// (recurring rules, Pay card, transfers) so every picker applies the same rules:
//
//   • a CREDIT card's liability account is shown AS its card — 1:1, never twice;
//   • a DEBIT card is a peer of its bank (the bank keeps its own tile) — picking
//     it means {account_id: the bank, card_id: the card};
//   • only usable cards are offered (open, not frozen, on a live account) — plus
//     any card the caller says is already selected, so editing an old row on a
//     card that was frozen since still shows what paid it.
import type { Card, WealthAccount } from "@/lib/types"
import { isCardExpired } from "@/lib/cards"
import { usableCards } from "@/lib/use-cards"

export type PayOption =
  | { key: string; kind: "account"; account: WealthAccount; card: null; expired: false }
  | { key: string; kind: "card"; card: Card; account: WealthAccount | null; expired: boolean }

export type PayOptions = {
  /** Cash / bank / other accounts (credit-card accounts that have a card are NOT here). */
  accounts: PayOption[]
  /** Credit cards (standing in for their account) and debit cards, in card order. */
  cards: PayOption[]
  all: PayOption[]
  byKey: Map<string, PayOption>
  /** The credit card that IS each liability account (by account id). */
  creditByAccount: Map<string, Card>
}

export function buildPayOptions(
  accounts: WealthAccount[],
  cards: Card[],
  opts: { todayIso: string; keepCardIds?: Iterable<string | null | undefined> },
): PayOptions {
  const byAccount = new Map(accounts.map((a) => [a.id, a]))
  const creditByAccount = new Map(cards.filter((c) => c.kind === "credit").map((c) => [c.account_id, c]))
  const keep = new Set<string>()
  for (const id of opts.keepCardIds ?? []) if (id) keep.add(id)
  const usable = new Set(usableCards(cards).map((c) => c.id))
  const offered = (c: Card) => usable.has(c.id) || keep.has(c.id)

  const accountOptions: PayOption[] = []
  for (const account of accounts) {
    if (account.type === "credit_card") {
      const cc = creditByAccount.get(account.id)
      // The card row is the account's identity; a frozen one is simply not offered.
      if (cc) continue
      // No card row (pre-backfill data) → fall back to the plain account tile.
    }
    accountOptions.push({ key: account.id, kind: "account", account, card: null, expired: false })
  }

  const cardOptions: PayOption[] = []
  for (const card of cards) {
    if (!offered(card)) continue
    const account = byAccount.get(card.account_id) ?? null
    // A card whose account is not in the offered list (archived bank, or a
    // caller that filtered accounts) is only shown when it is already selected.
    if (!account && !keep.has(card.id)) continue
    cardOptions.push({
      key: card.id,
      kind: "card",
      card,
      account,
      expired: isCardExpired(card.expiry_month, card.expiry_year, opts.todayIso),
    })
  }

  const all = [...accountOptions, ...cardOptions]
  return { accounts: accountOptions, cards: cardOptions, all, byKey: new Map(all.map((o) => [o.key, o])), creditByAccount }
}

/** The selection key of an allocation: the card when one paid, else the account — normalised so a legacy row on a credit-card account matches the card tile. */
export function allocationKey(alloc: { account_id: string; card_id?: string | null }, creditByAccount: Map<string, Card>): string {
  return alloc.card_id ?? creditByAccount.get(alloc.account_id)?.id ?? alloc.account_id
}

/** What selecting an option writes into an allocation. */
export function optionAllocation(option: PayOption): { account_id: string; card_id: string | null } {
  return option.kind === "card"
    ? { account_id: option.card.account_id, card_id: option.card.id }
    : { account_id: option.account.id, card_id: null }
}
