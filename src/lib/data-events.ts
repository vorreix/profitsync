// App-wide "data changed" signals, emitted centrally from the API client so every
// successful mutation notifies interested surfaces — pages no longer need to
// remember to dispatch after each apiPost/apiPatch/apiDelete.
//
// Two channels:
//  • DATA_CHANGED_EVENT — fired for EVERY successful mutation (detail = the API
//    path). DataRefreshProvider listens (debounced) and bumps its `revision`, so
//    aggregate pages (dashboard, analytics, calendar, flow, budget cards) refetch
//    silently in place.
//  • WEALTH_CHANGED_EVENT — the long-standing `wealth:accounts-changed` event,
//    now also fired for every mutation that can move an account balance
//    (transactions, transfers, wealth accounts, trash restore/purge, client
//    deletes, recurring rules). Existing listeners (account pickers, wealth
//    cards) refresh their balances without each mutation site dispatching by hand.

export const DATA_CHANGED_EVENT = "ps:data-changed"
export const WEALTH_CHANGED_EVENT = "wealth:accounts-changed"

export type DataChangedDetail = { path: string }

// Paths whose mutations can change a wealth account balance.
const WEALTH_AFFECTING = /^\/api\/(transactions|wealth|trash|recurring|clients)\b/

export function emitDataChanged(path: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<DataChangedDetail>(DATA_CHANGED_EVENT, { detail: { path } }))
  if (WEALTH_AFFECTING.test(path)) window.dispatchEvent(new Event(WEALTH_CHANGED_EVENT))
}
