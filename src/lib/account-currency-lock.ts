// May this account's currency still change? ONE predicate, read by the PATCH
// that refuses the change and by the account GETs, whose `currency_locked` flag
// enables the Edit dialog's picker. Two copies once disagreed (the picker
// counted live rows, the server live + trashed), so the picker offered a save
// that could only fail (MC-062).
//
// A currency is the LABEL on every amount the account holds or will receive;
// relabelling re-denominates them without moving a cent (€50 becomes $50). So it
// may change only while nothing is denominated in it yet:
//   • no row, live or trashed (trash restores),
//   • no balance (a purged opening balance can leave one with no row behind it),
//   • nothing that will post into it later or reads its currency — a recurring
//     rule (expense, auto-save or debt repayment, active or paused), a card that
//     spends from it or is paid from it, an unsettled (planned/pending) transfer,
//   • and it is not a card, a debt or a goal Space, whose limits, terms and
//     targets are amounts fixed in the currency they were created in.
// The facts are gathered by api/_lib/account-currency-lock.ts.

export type AccountCurrencyLockReason = "history" | "balance" | "recurring" | "card" | "transfer" | "configured"

export type AccountCurrencyFacts = {
  type: string
  currentBalance: number | string | null
  openingBalance: number | string | null
  goalAmount?: number | string | null
  hasRows: boolean
  hasRecurring: boolean
  hasCards: boolean
  hasOpenTransfers: boolean
}

// NaN (garbage) counts as non-zero: unsure means locked.
const nonZero = (v: number | string | null | undefined) => Number(v ?? 0) !== 0

/** Why the currency is locked, or null when it may change. */
export function accountCurrencyLockReason(f: AccountCurrencyFacts): AccountCurrencyLockReason | null {
  if (f.hasRows) return "history"
  if (nonZero(f.currentBalance) || nonZero(f.openingBalance)) return "balance"
  if (f.hasRecurring) return "recurring"
  if (f.hasCards) return "card"
  if (f.hasOpenTransfers) return "transfer"
  if (f.type === "credit_card" || f.type === "loan" || f.type === "receivable" || nonZero(f.goalAmount)) return "configured"
  return null
}
