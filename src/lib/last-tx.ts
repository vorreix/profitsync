// Remembers the last-used add-transaction selections (client, type, category) so
// the next "Add transaction" is pre-filled with the same context. The date is
// intentionally NOT remembered — it always defaults to today.
const KEY = "ps_last_tx"

export type LastTxDefaults = {
  client_id?: string
  type?: "incoming" | "outgoing"
  category?: string
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
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable — non-fatal */
  }
}
