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

// ── System-written descriptions ──────────────────────────────────────────────
//
// The transfer engine writes a few rows whose text nobody typed: the fee a
// transfer cost, the fee a reversal refunds, and the two legs of a reversal.
// The stored text is English and stays that way — it is what search, exports,
// push and pinned old builds read. These constants are the stable MARKERS the
// server writes (api/_lib/wealth-accounts.ts, and 'Transfer fee' inside
// complete_transfer, mig 0073); a screen translates a row carrying one at
// display time with `ledgerDescription` (MC-155). A row the user re-described
// no longer carries a marker and is shown exactly as they wrote it.
export const TRANSFER_FEE_CATEGORY = "Transfer Fee"
export const TRANSFER_FEE_DESCRIPTION = "Transfer fee"
export const TRANSFER_FEE_REFUND_DESCRIPTION = "Transfer fee refund"
export const TRANSFER_REVERSAL_DESCRIPTION = "Transfer reversal"

/** The separator the server puts between a marker and the transfer's note. */
const NOTE_SEPARATOR = " — "
// Reversals once stored this as their note (and so as the fee refund's suffix):
// an English sentence around a uuid, which says nothing `reverses_transfer_id`
// does not. Rows written before that stopped drop it on display.
const LEGACY_REVERSAL_NOTE = /^Reversal of transfer [0-9a-f-]{36}$/i

export type LedgerTextRow = {
  description?: string | null
  category?: string | null
  kind?: string | null
}

const SYSTEM_TEXTS: { text: string; key: string; applies: (row: LedgerTextRow) => boolean }[] = [
  // Longest first: "Transfer fee refund" also starts with "Transfer fee".
  { text: TRANSFER_FEE_REFUND_DESCRIPTION, key: "wealth.ledgerText.transferFeeRefund", applies: (r) => r.category === TRANSFER_FEE_CATEGORY },
  { text: TRANSFER_FEE_DESCRIPTION, key: "wealth.ledgerText.transferFee", applies: (r) => r.category === TRANSFER_FEE_CATEGORY },
  { text: TRANSFER_REVERSAL_DESCRIPTION, key: "wealth.ledgerText.transferReversal", applies: (r) => r.kind === "transfer" },
]

/**
 * The i18n key + note of a system-written description, or null when the row
 * carries the user's own text. Pure, so the matching is unit-tested.
 */
export function systemDescription(row: LedgerTextRow): { key: string; note: string } | null {
  const description = row.description ?? ""
  for (const s of SYSTEM_TEXTS) {
    if (!s.applies(row)) continue
    if (description === s.text) return { key: s.key, note: "" }
    if (description.startsWith(s.text + NOTE_SEPARATOR)) {
      const note = description.slice(s.text.length + NOTE_SEPARATOR.length).trim()
      return { key: s.key, note: LEGACY_REVERSAL_NOTE.test(note) ? "" : note }
    }
  }
  return null
}

/**
 * A ledger row's description in the reader's language: the translated marker
 * (+ the transfer's note) for a system-written row, the stored text otherwise.
 * `t` is any i18next `t` that resolves full keys (the default namespace).
 */
export function ledgerDescription(row: LedgerTextRow, t: (key: string) => string): string {
  const system = systemDescription(row)
  if (!system) return row.description ?? ""
  const label = t(system.key)
  return system.note ? `${label}${NOTE_SEPARATOR}${system.note}` : label
}
