// Pure helpers for split/grouped transactions, shared by the UI. The server does
// the actual SQL grouping (and the group's money — api/_lib/tx-group-sql.ts:
// legs in different currencies are never added raw); these are the small,
// unit-tested bits the client uses to decide how to render a row.

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
