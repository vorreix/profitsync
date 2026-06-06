// Pure helpers for split/grouped transactions, shared by the UI. The server does
// the actual SQL grouping; these are the small, unit-tested bits the client uses
// to decide how to render a row and to summarize a set of legs.

export type LegLike = {
  amount: number | string
  wealth_account_id?: string | null
}

export type LegSummary = {
  /** Sum of all leg amounts (the group total shown on the collapsed row). */
  total: number
  /** Number of legs (transactions) in the group. */
  leg_count: number
  /** Number of distinct accounts the legs touch. */
  account_count: number
}

/** Summarize a set of legs into the figures a collapsed group row displays. */
export function summarizeLegs(legs: LegLike[]): LegSummary {
  const total = legs.reduce((sum, l) => sum + Number(l.amount || 0), 0)
  const accounts = new Set(
    legs.map((l) => l.wealth_account_id ?? "").filter((id) => id !== ""),
  )
  return { total, leg_count: legs.length, account_count: accounts.size }
}

/**
 * True when a transaction row represents more than one account-leg (a split).
 * Works on both a collapsed grouped row (`leg_count` set) and a row carrying its
 * loaded `legs`.
 */
export function isSplitTx(tx: {
  leg_count?: number
  legs?: unknown[]
  group_id?: string | null
}): boolean {
  if (typeof tx.leg_count === "number") return tx.leg_count > 1
  if (Array.isArray(tx.legs)) return tx.legs.length > 1
  return false
}
