import type { VercelRequest } from "@vercel/node"
import { CLIENT_CAPABILITIES_HEADER, MULTI_CURRENCY, hasCapability, needsClientUpdate } from "../../src/lib/client-capabilities.js"

/** Did this request come from a build that shows foreign-currency money correctly? (MC-034) */
export function hasMultiCurrencyClient(req: VercelRequest): boolean {
  return hasCapability(req.headers[CLIENT_CAPABILITIES_HEADER], MULTI_CURRENCY)
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
