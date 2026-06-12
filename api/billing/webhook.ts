import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { invoices, subscriptions } from "../../src/lib/db/schema.js"
import { verifyWebhookSignature, type DodoEnv, type DodoScheduledChange } from "../_lib/dodo.js"
import { resolveScheduledChange } from "../_lib/billing-sync.js"
import { invoiceStatusForPayment } from "../_lib/invoice-map.js"
import { creditReferralOnPaid } from "../_lib/referral.js"
import { markAttemptByRef } from "../_lib/billing-attempts.js"

export const config = {
  api: {
    bodyParser: false, // we need the raw body to verify the Standard Webhooks signature
  },
}

async function readBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function header(req: VercelRequest, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

// Map a Dodo subscription webhook event onto our internal status.
function statusForEvent(event: string): "active" | "past_due" | "cancelled" | null {
  switch (event) {
    case "subscription.active":
    case "subscription.renewed":
    case "subscription.plan_changed":
      return "active"
    case "subscription.on_hold":
    case "subscription.failed":
      return "past_due"
    case "subscription.cancelled":
    case "subscription.expired":
      return "cancelled"
    default:
      return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const raw = await readBody(req)

  let webhookEnv: DodoEnv | null = null
  try {
    const { valid, env } = verifyWebhookSignature(raw, {
      id: header(req, "webhook-id"),
      timestamp: header(req, "webhook-timestamp"),
      signature: header(req, "webhook-signature"),
    })
    if (!valid) return res.status(400).json({ error: "Invalid signature" })
    // The matching signing secret authoritatively tells us which Dodo environment
    // this webhook came from — used below to backfill legacy subscriptions whose
    // dodo_environment is null (created before per-plan environments existed).
    webhookEnv = env ?? null
  } catch (err) {
    // Misconfiguration (no secret) — surface 500 so the failure is visible in logs.
    return res.status(500).json({ error: err instanceof Error ? err.message : "Verification failed" })
  }

  let payload: {
    type: string
    data: Record<string, unknown> & { payload_type?: string }
  }
  try {
    payload = JSON.parse(raw)
  } catch {
    return res.status(400).json({ error: "Invalid JSON" })
  }

  const event = payload.type
  const data = payload.data ?? {}

  // ── Subscription lifecycle ────────────────────────────────────────────────
  if (data.payload_type === "Subscription" || event.startsWith("subscription.")) {
    const subId = data.subscription_id as string | undefined
    const metadata = (data.metadata as Record<string, string> | undefined) ?? {}
    const orgId = metadata.organization_id

    // Match by provider subscription id first, then by org id from metadata.
    let sub
    if (subId) {
      ;[sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerSubscriptionId, subId))
        .orderBy(desc(subscriptions.updatedAt))
    }
    if (!sub && orgId) {
      ;[sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, orgId))
        .orderBy(desc(subscriptions.updatedAt))
    }

    if (sub) {
      const nextStatus = statusForEvent(event)
      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (nextStatus) updates.status = nextStatus
      if (subId && !sub.providerSubscriptionId) updates.providerSubscriptionId = subId
      if (metadata.plan_key) updates.planKey = metadata.plan_key
      if (metadata.billing_cycle) updates.billingCycle = metadata.billing_cycle
      // Self-heal legacy rows: a subscription's env is fixed for life, so if it's
      // missing, adopt the env that signed this webhook (the authoritative source).
      if (webhookEnv && !sub.dodoEnvironment) updates.dodoEnvironment = webhookEnv

      const prevBilling = data.previous_billing_date as string | undefined
      if (prevBilling) updates.currentPeriodStart = new Date(prevBilling)
      const nextBilling = data.next_billing_date as string | undefined
      if (nextBilling) updates.currentPeriodEnd = new Date(nextBilling)

      // Keep any scheduled cycle switch (e.g. monthly → yearly) in sync with Dodo.
      const planKeyForResolve = (metadata.plan_key ?? sub.planKey) as string
      updates.scheduledChange = await resolveScheduledChange(
        data.scheduled_change as DodoScheduledChange | undefined,
        planKeyForResolve,
      )

      if (nextStatus === "cancelled") {
        updates.cancelledAt = new Date()
        updates.cancelAt = sub.currentPeriodEnd ?? new Date()
      }

      await db.update(subscriptions).set(updates).where(eq(subscriptions.id, sub.id))
    }

    // Attempt log: a now-active subscription completes its checkout attempt
    // (linked via metadata.attempt_id, falling back to the Dodo sub id).
    if (statusForEvent(event) === "active") {
      await markAttemptByRef(
        { attemptId: metadata.attempt_id, dodoSubscriptionId: subId, orgId },
        { status: "completed" },
      )
    }
  }

  // ── Payment succeeded → record an invoice (best-effort) ───────────────────
  if (event === "payment.succeeded" && data.payload_type === "Payment") {
    try {
      const subId = data.subscription_id as string | undefined
      const [sub] = subId
        ? await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, subId))
        : []
      if (sub) {
        const paymentId = data.payment_id as string | undefined
        const minorAmount = (data.total_amount ?? data.settlement_amount ?? data.amount) as number | undefined
        const currency = (data.currency ?? data.settlement_currency ?? "USD") as string
        // Use the payment's own timestamp so the invoice's issued/paid date matches
        // Dodo (and the reconcile path's invoiceValuesFromPayment) instead of the
        // webhook-handler clock — otherwise a later reconcile rewrites the row.
        const paidAt = data.created_at ? new Date(data.created_at as string) : new Date()
        const baseValues = {
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          amount: String((minorAmount ?? 0) / 100),
          currency,
          status: "paid",
          provider: "dodo",
          providerInvoiceId: paymentId ?? null,
          issuedAt: paidAt,
          paidAt,
        }
        // Atomic upsert keyed by the Dodo payment id, so a webhook retry or a
        // concurrent reconcile can't create a duplicate invoice for one payment.
        if (paymentId) {
          await db
            .insert(invoices)
            .values(baseValues)
            .onConflictDoUpdate({ target: invoices.providerInvoiceId, set: baseValues })
        } else {
          await db.insert(invoices).values(baseValues)
        }
        // Credit a pending referral for this org's owner (idempotent: only a
        // signed_up referral becomes paid, so renewals / retries don't re-credit).
        await creditReferralOnPaid(sub.organizationId, (minorAmount ?? 0) / 100, currency)
        // Attempt log: a successful payment completes the checkout attempt.
        await markAttemptByRef(
          { attemptId: (data.metadata as Record<string, string> | undefined)?.attempt_id, dodoSubscriptionId: subId, orgId: sub.organizationId },
          { status: "completed", dodoPaymentId: paymentId },
        )
      }
    } catch {
      // Non-fatal: invoice bookkeeping failure must not 500 the webhook.
    }
  }

  // ── Payment failed → record an uncollectible invoice + flag the sub past_due ──
  // A failed renewal charge would otherwise be invisible until the next reconcile.
  // We persist it immediately so the admin/subscriptions + billing pages reflect it.
  if (event === "payment.failed" && data.payload_type === "Payment") {
    try {
      const subId = data.subscription_id as string | undefined
      const [sub] = subId
        ? await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, subId))
        : []
      if (sub) {
        const paymentId = data.payment_id as string | undefined
        const minorAmount = (data.total_amount ?? data.settlement_amount ?? data.amount) as number | undefined
        const currency = (data.currency ?? data.settlement_currency ?? "USD") as string
        const failedAt = data.created_at ? new Date(data.created_at as string) : new Date()
        const baseValues = {
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          amount: String((minorAmount ?? 0) / 100),
          currency,
          status: invoiceStatusForPayment("failed"), // → "uncollectible"
          provider: "dodo",
          providerInvoiceId: paymentId ?? null,
          issuedAt: failedAt,
          paidAt: null, // a failed charge is never paid
        }
        // Same idempotent upsert as the succeeded path: a webhook retry can't create
        // a duplicate invoice for the same payment.
        if (paymentId) {
          await db
            .insert(invoices)
            .values(baseValues)
            .onConflictDoUpdate({ target: invoices.providerInvoiceId, set: baseValues })
        } else {
          await db.insert(invoices).values(baseValues)
        }
        // A failed renewal → mark a currently-active subscription past_due so the UI
        // and quota gates reflect the dunning state. Dodo usually also follows up with
        // subscription.on_hold/failed (handled above); doing it here too is just more
        // timely and idempotent. Leave pending/cancelled rows untouched.
        if (sub.status === "active") {
          await db
            .update(subscriptions)
            .set({ status: "past_due", updatedAt: new Date() })
            .where(eq(subscriptions.id, sub.id))
        }
        // Attempt log: record the failure + the raw payload for admin forensics.
        await markAttemptByRef(
          { attemptId: (data.metadata as Record<string, string> | undefined)?.attempt_id, dodoSubscriptionId: subId, orgId: sub.organizationId },
          {
            status: "failed",
            dodoPaymentId: paymentId,
            providerErrorMessage: String(data.error_message ?? data.failure_reason ?? data.error_code ?? "payment.failed"),
            webhookErrorDetails: data,
          },
        )
      }
    } catch {
      // Non-fatal: invoice bookkeeping failure must not 500 the webhook.
    }
  }

  return res.json({ ok: true })
}
