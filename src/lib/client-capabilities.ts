// What this build can do, told to the server on every API request (MC-034).
//
// Store-pinned native builds and stale PWAs keep calling the newest API for
// months. A build from before multi-currency shows every account in the
// workspace currency and adds them up unconverted, so the server must not let
// it CREATE money in another currency — and it can only tell builds apart if
// the new ones say so. Old builds send nothing; the absence is the signal.
//
// Shared by src/lib/api.ts (sends it) and api/_lib/client-capabilities.ts
// (reads it). Add a capability only when the server gates on it.

/** Lower-case: Node lower-cases every incoming header name. */
export const CLIENT_CAPABILITIES_HEADER = "x-client-capabilities"
export const MULTI_CURRENCY = "multi-currency"
/** The header value this build sends (comma-separated). */
export const CLIENT_CAPABILITIES = MULTI_CURRENCY

/** Does a received header value list `capability`? */
export function hasCapability(header: string | string[] | undefined, capability: string): boolean {
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "")
  return raw.split(",").some((c) => c.trim().toLowerCase() === capability)
}

/**
 * Must creating an account / Space / card / debt in `currency` be refused?
 * Only for a client that did not announce multi-currency, and only when the
 * currency differs from the workspace's reporting currency. No currency means
 * the server's default (the reporting one), so it is never gated.
 */
export function needsClientUpdate(currency: string | null | undefined, reporting: string, multiCurrencyClient: boolean): boolean {
  if (multiCurrencyClient || !currency?.trim()) return false
  return currency.trim().toUpperCase() !== reporting.trim().toUpperCase()
}
