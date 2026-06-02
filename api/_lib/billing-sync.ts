import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { invoices, plans, subscriptions } from "../../src/lib/db/schema.js"
import {
  getSubscription,
  isDodoConfigured,
  listPayments,
  mapDodoStatus,
  type DodoEnv,
  type DodoScheduledChange,
} from "./dodo.js"
import { invoiceValuesFromPayment } from "./invoice-map.js"

type SubscriptionRow = typeof subscriptions.$inferSelect

export type ScheduledChange = { billing_cycle: string | null; product_id: string; effective_at: string }

/**
 * Turn Dodo's `scheduled_change` into the jsonb we store, inferring the target
 * billing cycle by matching the scheduled product id against the plan's
 * monthly/yearly product ids. Returns null when nothing is scheduled.
 */
export async function resolveScheduledChange(
  scheduled: DodoScheduledChange | undefined,
  planKey: string,
): Promise<ScheduledChange | null> {
  if (!scheduled) return null
  let billingCycle: string | null = null
  const [plan] = await db.select().from(plans).where(eq(plans.key, planKey))
  if (plan) {
    if (plan.dodoProductYearly === scheduled.product_id) billingCycle = "yearly"
    else if (plan.dodoProductMonthly === scheduled.product_id) billingCycle = "monthly"
  }
  return {
    billing_cycle: billingCycle,
    product_id: scheduled.product_id,
    effective_at: scheduled.effective_at,
  }
}

/**
 * Reconcile invoice rows for a subscription from Dodo's payment history.
 *
 * The `payment.succeeded` webhook is best-effort and may not be configured for
 * every Dodo environment (e.g. a TEST plan running on a LIVE deployment), so the
 * invoices list would otherwise stay empty even after a successful charge. This
 * pulls the authoritative payment history and upserts one invoice per payment,
 * idempotently keyed by the Dodo payment id. Non-fatal: never throws.
 *
 * Returns the number of invoice rows written (inserted or updated).
 */
export async function reconcileInvoices(
  sub: { id: string; organizationId: string; providerSubscriptionId: string | null; provider: string | null },
  env: DodoEnv,
): Promise<number> {
  if (sub.provider !== "dodo" || !sub.providerSubscriptionId) return 0
  try {
    const payments = await listPayments(sub.providerSubscriptionId, env)
    let written = 0
    for (const payment of payments) {
      if (!payment.payment_id) continue
      const values = invoiceValuesFromPayment(payment, {
        organizationId: sub.organizationId,
        subscriptionId: sub.id,
      })
      // Atomic upsert keyed by the Dodo payment id — concurrent reconcile/webhook
      // writes for the same payment collapse to one row instead of racing
      // check-then-insert (which produced duplicate invoices).
      await db
        .insert(invoices)
        .values(values)
        .onConflictDoUpdate({ target: invoices.providerInvoiceId, set: values })
      written += 1
    }
    return written
  } catch {
    // Invoice bookkeeping must never break subscription reconciliation.
    return 0
  }
}

/**
 * Pull a subscription's authoritative state from Dodo and persist it: status,
 * period start/end (so the UI can show both "started" and "renews on"), any
 * scheduled cycle switch, cancellation dates, and the payment history → invoices.
 *
 * Self-guards: a no-op (returns the row unchanged, `synced: false`) when the
 * subscription isn't a configured Dodo subscription. Throws only on a Dodo API
 * failure, so callers decide whether that should surface (sync) or be swallowed
 * (a best-effort reconcile on a GET).
 */
export async function reconcileSubscriptionFromDodo(
  sub: SubscriptionRow,
  env: DodoEnv,
): Promise<{ subscription: SubscriptionRow; remoteStatus: string | null; synced: boolean }> {
  if (sub.provider !== "dodo" || !sub.providerSubscriptionId || !isDodoConfigured(env)) {
    return { subscription: sub, remoteStatus: null, synced: false }
  }

  const remote = await getSubscription(sub.providerSubscriptionId, env)
  const mapped = mapDodoStatus(remote.status)
  const updates: Record<string, unknown> = { status: mapped, updatedAt: new Date() }
  if (remote.previous_billing_date) updates.currentPeriodStart = new Date(remote.previous_billing_date)
  if (remote.next_billing_date) updates.currentPeriodEnd = new Date(remote.next_billing_date)
  updates.scheduledChange = await resolveScheduledChange(remote.scheduled_change, sub.planKey)

  if (remote.cancel_at_next_billing_date) {
    updates.cancelAt = remote.next_billing_date ? new Date(remote.next_billing_date) : new Date()
  } else {
    // Cancellation was reverted upstream (or never set) — clear our copy.
    updates.cancelAt = null
  }
  updates.cancelledAt = remote.cancelled_at ? new Date(remote.cancelled_at) : null

  const [updated] = await db
    .update(subscriptions)
    .set(updates)
    .where(eq(subscriptions.id, sub.id))
    .returning()

  const row = updated ?? sub
  // Don't pull payments for a not-yet-paid subscription (none exist yet).
  if (mapped !== "pending") await reconcileInvoices(row, env)

  return { subscription: row, remoteStatus: remote.status, synced: true }
}
