// Remembers the last-used add-transaction selections (client, type, category,
// source account) so the next "Add transaction" is pre-filled with the same
// context. The date is intentionally NOT remembered — it always defaults to today.
const KEY = "ps_last_tx"

export type LastTxDefaults = {
  client_id?: string
  type?: "incoming" | "outgoing"
  category?: string
  wealth_account_id?: string
}

export function loadLastTx(): LastTxDefaults {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const v = JSON.parse(raw) as LastTxDefaults
    return v && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

export function saveLastTx(v: LastTxDefaults) {
  try {
    // Merge so a partial save (e.g. just the source account) doesn't wipe the
    // other remembered fields.
    localStorage.setItem(KEY, JSON.stringify({ ...loadLastTx(), ...v }))
  } catch {
    /* storage unavailable — non-fatal */
  }
}
