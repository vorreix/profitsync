// Single source of truth for how a transaction moves a wealth account balance.
//
// Wealth `current_balance` is STORED (not derived), so every transaction
// create/delete/restore mutates it. Getting the sign right is money-critical:
//   • create  → balance + balanceDelta(type, amount)
//   • delete  → balance + reverseDelta(type, amount)   (undoes the create)
//   • restore → balance + balanceDelta(type, amount)   (re-applies the create)
//
// Keeping these here (with tests) prevents the sign from drifting or being
// "fixed" incorrectly across the several API routes that touch balances.

/** The balance change an `incoming`(+)/`outgoing`(−) transaction applies on create. */
export function balanceDelta(type: string, amount: number | string): number {
  const n = Number(amount)
  return type === "incoming" ? n : -n
}

/** The balance change that *undoes* a transaction (used on delete/purge). */
export function reverseDelta(type: string, amount: number | string): number {
  return -balanceDelta(type, amount)
}

export type LedgerLeg = {
  wealthAccountId: string | null
  type: string
  amount: number | string
}

/**
 * Sum the balance *reversals* per wealth account for a set of legs being deleted,
 * so several legs on one account collapse into a single balance UPDATE. Returns
 * accountId → signed delta to ADD to current_balance. Legs without an account are
 * ignored. Pure (deterministic) so the money math is unit-tested.
 */
export function reversalsByAccount(legs: LedgerLeg[]): Map<string, number> {
  const shifts = new Map<string, number>()
  for (const leg of legs) {
    if (!leg.wealthAccountId) continue
    shifts.set(leg.wealthAccountId, (shifts.get(leg.wealthAccountId) ?? 0) + reverseDelta(leg.type, leg.amount))
  }
  return shifts
}
