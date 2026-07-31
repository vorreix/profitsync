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
  isSystem?: boolean | null
}

/**
 * Whether a transaction's balance effect should be reversed/re-applied when it
 * moves through Trash (delete → restore → purge).
 *
 * SYSTEM transactions ("Opening Balance", "Balance Adjustment" — the
 * azzeramento/reset) do NOT flow like income/expense: they *define* what the
 * account balance IS at a point in time. Their amount is written directly into
 * `current_balance` at create time. Reversing one on delete (or re-applying it
 * on restore) would silently move money and undo the very reset the user made —
 * e.g. zeroing a wallet, then deleting that "reset" entry, re-deposits the old
 * amount. So Trash logic must leave the stored balance untouched for them:
 * deleting a reset entry just files the record away, it does not refund money.
 *
 * (`is_system` is the reliable discriminator — it already tags exactly these two
 * balance-defining entries, and it covers rows created before this rule existed,
 * so no backfill/migration is needed.)
 */
export function reversesOnTrash(leg: { isSystem?: boolean | null }): boolean {
  return !leg.isSystem
}

/**
 * Sum the balance *reversals* per wealth account for a set of legs being deleted,
 * so several legs on one account collapse into a single balance UPDATE. Returns
 * accountId → signed delta to ADD to current_balance. Legs without an account —
 * and system balance-defining legs (see reversesOnTrash) — are ignored. Pure
 * (deterministic) so the money math is unit-tested.
 */
export function reversalsByAccount(legs: LedgerLeg[]): Map<string, number> {
  const shifts = new Map<string, number>()
  for (const leg of legs) {
    if (!leg.wealthAccountId || !reversesOnTrash(leg)) continue
    shifts.set(leg.wealthAccountId, (shifts.get(leg.wealthAccountId) ?? 0) + reverseDelta(leg.type, leg.amount))
  }
  return shifts
}

/**
 * Sum the balance *re-applications* per wealth account for a set of legs being
 * restored from Trash (the inverse of reversalsByAccount). Returns accountId →
 * signed delta to ADD to current_balance. System balance-defining legs are
 * ignored for the same reason they are not reversed on delete.
 */
export function applicationsByAccount(legs: LedgerLeg[]): Map<string, number> {
  const shifts = new Map<string, number>()
  for (const leg of legs) {
    if (!leg.wealthAccountId || !reversesOnTrash(leg)) continue
    shifts.set(leg.wealthAccountId, (shifts.get(leg.wealthAccountId) ?? 0) + balanceDelta(leg.type, leg.amount))
  }
  return shifts
}
