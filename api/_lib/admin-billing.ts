import { cancelSubscription, defaultDodoEnv, isDodoConfigured, type DodoEnv } from "./dodo.js"

/**
 * Admin-side billing helpers that keep the local `subscriptions` mirror and the
 * real Dodo subscription in sync when an admin forces a plan/status change.
 *
 * The admin console used to write plan/status straight to the DB and never call
 * Dodo, which left two bugs: a stale "Renews on …" date (the period/cancel fields
 * were never cleared) and a Dodo subscription that kept its `active` status and
 * kept billing. These helpers fix both.
 *
 * This module imports ONLY from `dodo.ts` (no database import), so its pure logic
 * is unit-testable without opening a Neon connection. The DB writes themselves live
 * in the route handlers that call `stopDodoBilling` + spread `FREE_RESET_FIELDS`.
 */

/** The subset of a subscription row needed to decide/perform a Dodo cancellation. */
export type DodoSubFields = {
  provider: string | null
  providerSubscriptionId: string | null
  dodoEnvironment: string | null
}

/**
 * Column values that reset a subscription row to the implicit Free tier, clearing
 * every Dodo-mirror field so the UI shows no stale renew date / billing cycle /
 * provider id. Mirrors the self-serve "switch to free" path in
 * `billing/create-subscription.ts` so admin and self-serve downgrades leave
 * identical, unambiguous state. Spread it with a fresh `updatedAt` at the call site:
 *
 *   db.update(subscriptions).set({ ...FREE_RESET_FIELDS, updatedAt: new Date() })
 */
export const FREE_RESET_FIELDS = {
  planKey: "free",
  status: "active",
  billingCycle: null,
  dodoEnvironment: null,
  provider: null,
  providerSubscriptionId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  scheduledChange: null,
  cancelAt: null,
  cancelledAt: null,
} as const

/**
 * Column values that mark a subscription cancelled *immediately* while keeping the
 * plan key for history. `cancelAt = cancelledAt = now` (it ended now, not at a future
 * period end) and any pending scheduled change is dropped.
 */
export function cancelledNowFields(now: Date) {
  return {
    status: "cancelled" as const,
    cancelledAt: now,
    cancelAt: now,
    scheduledChange: null,
  }
}

/** True when this row corresponds to a live Dodo subscription we can cancel upstream. */
export function isDodoSubscription(sub: DodoSubFields): boolean {
  return sub.provider === "dodo" && !!sub.providerSubscriptionId
}

/** Resolve the Dodo environment for a subscription row (its snapshot, or the default). */
export function dodoEnvForSub(sub: Pick<DodoSubFields, "dodoEnvironment">): DodoEnv {
  return (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
}

/**
 * A Dodo error that means the subscription is already gone (not found / already
 * cancelled). There's nothing left to cancel, so for our purposes it's a success —
 * we just want billing stopped, and it already is. Dodo's `call()` surfaces errors
 * as `Dodo <status>: <body>`, so we key off the 404/409 status and a couple of
 * defensive text matches. A 401/403/5xx is a *real* failure and is NOT swallowed.
 */
export function isAlreadyGoneCancelError(message: string): boolean {
  if (/\bDodo (404|409)\b/.test(message)) return true
  return /not[\s_-]?found|already (cancel|terminat|expir)/i.test(message)
}

/** Outcome of trying to stop billing on Dodo for one subscription. */
export type StopBillingResult =
  | { provider: "none" } // no Dodo counterpart (stub/manual/free/unconfigured) — nothing to do
  | { provider: "dodo"; ok: true } // cancelled upstream (or already gone)
  | { provider: "dodo"; ok: false; error: string }

/**
 * Immediately stop billing on Dodo for a subscription so the customer is no longer
 * charged and Dodo no longer reports it `active`. No-op (`provider: "none"`) for
 * rows without a live Dodo counterpart. Treats an already-gone subscription as
 * success. Never throws — returns a structured result so a bulk caller can continue
 * past a single failure and report per-row outcomes.
 */
export async function stopDodoBilling(sub: DodoSubFields): Promise<StopBillingResult> {
  if (!isDodoSubscription(sub)) return { provider: "none" }
  const env = dodoEnvForSub(sub)
  if (!isDodoConfigured(env)) return { provider: "none" }
  try {
    await cancelSubscription(sub.providerSubscriptionId as string, env, true) // immediate
    return { provider: "dodo", ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dodo cancel failed"
    if (isAlreadyGoneCancelError(message)) return { provider: "dodo", ok: true }
    return { provider: "dodo", ok: false, error: message }
  }
}
