import type { VercelRequest } from "@vercel/node"
import { CLIENT_CAPABILITIES_HEADER, MULTI_CURRENCY, hasCapability, needsClientUpdate } from "../../src/lib/client-capabilities.js"

/** Did this request come from a build that shows foreign-currency money correctly? (MC-034) */
export function hasMultiCurrencyClient(req: VercelRequest): boolean {
  return hasCapability(req.headers[CLIENT_CAPABILITIES_HEADER], MULTI_CURRENCY)
}

/**
 * A recurring rule's `last_error` as the requesting build can show it (MC-077).
 * The materializer stores a refusal body `{ error, code, ...params }`, which a
 * current build translates (src/components/recurring/rule-error.ts). A build
 * from before multi-currency prints the field as it is, so it gets the body's
 * English `error` — the sentence it always got. A plain-text value (written
 * before the body) or anything that does not parse passes through unchanged.
 */
export function ruleErrorFor(req: VercelRequest, stored: string | null | undefined): string {
  const text = stored ?? ""
  if (!text.trimStart().startsWith("{") || hasMultiCurrencyClient(req)) return text
  try {
    const { error } = JSON.parse(text) as { error?: unknown }
    return typeof error === "string" ? error : text
  } catch {
    return text
  }
}

/** `row` with its `lastError` shaped for this build — every response carrying a rule goes through it. */
export function withRuleError<T extends { lastError: string | null }>(req: VercelRequest, row: T): T {
  return { ...row, lastError: ruleErrorFor(req, row.lastError) }
}

/**
 * The 409 for a pre-multi-currency build creating an account / Space / card /
 * debt in a currency other than the workspace's reporting one; null otherwise.
 * `error` is the sentence an old build shows as-is, so it says what to do.
 */
export function clientUpdateRefusal(req: VercelRequest, currency: string | null | undefined, reporting: string) {
  return needsClientUpdate(currency, reporting, hasMultiCurrencyClient(req))
    ? { error: "Update the app to use accounts in another currency.", code: "client_update_required" }
    : null
}
