import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db } from "../../src/lib/db"
import { invoices, subscriptions } from "../../src/lib/db/schema"
import { verifyWebhookSignature } from "../_lib/razorpay"

export const config = {
  api: {
    bodyParser: false, // we need the raw body to verify the signature
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const raw = await readBody(req)
  const signature = req.headers["x-razorpay-signature"]

  try {
    if (!verifyWebhookSignature(raw, signature)) {
      return res.status(400).json({ error: "Invalid signature" })
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Verification failed" })
  }

  const payload = JSON.parse(raw) as {
    event: string
    payload: Record<string, { entity: Record<string, unknown> }>
  }

  const event = payload.event
  const subEntity = payload.payload?.subscription?.entity as
    | { id?: string; status?: string; current_end?: number; notes?: Record<string, string> }
    | undefined
  const paymentEntity = payload.payload?.payment?.entity as
    | { id?: string; amount?: number; currency?: string; status?: string }
    | undefined
  const invoiceEntity = payload.payload?.invoice?.entity as
    | { id?: string; subscription_id?: string; amount?: number; currency?: string; status?: string; short_url?: string }
    | undefined

  // 1. Subscription lifecycle events
  if (subEntity?.id) {
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, subEntity.id))
      .orderBy(desc(subscriptions.updatedAt))

    if (sub) {
      let nextStatus = sub.status
      const updates: Record<string, unknown> = {}

      if (event === "subscription.activated" || event === "subscription.charged") nextStatus = "active"
      if (event === "subscription.cancelled") nextStatus = "cancelled"
      if (event === "subscription.completed") nextStatus = "cancelled"
      if (event === "subscription.halted" || event === "subscription.paused") nextStatus = "past_due"

      updates.status = nextStatus
      if (subEntity.current_end) updates.currentPeriodEnd = new Date(subEntity.current_end * 1000)
      if (event === "subscription.cancelled" || event === "subscription.completed") {
        updates.cancelledAt = new Date()
      }
      updates.updatedAt = new Date()

      await db.update(subscriptions).set(updates).where(eq(subscriptions.id, sub.id))
    }
  }

  // 2. Invoice lifecycle events
  if (invoiceEntity?.id && event.startsWith("invoice.")) {
    const [sub] = invoiceEntity.subscription_id
      ? await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.providerSubscriptionId, invoiceEntity.subscription_id))
      : []

    if (sub) {
      const [existing] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.providerInvoiceId, invoiceEntity.id))

      const baseValues = {
        organizationId: sub.organizationId,
        subscriptionId: sub.id,
        amount: String((invoiceEntity.amount ?? 0) / 100),
        currency: invoiceEntity.currency ?? "USD",
        status: event === "invoice.paid" ? "paid" : invoiceEntity.status ?? "open",
        provider: "razorpay",
        providerInvoiceId: invoiceEntity.id,
        pdfUrl: invoiceEntity.short_url ?? null,
        paidAt: event === "invoice.paid" ? new Date() : null,
      }

      if (existing) {
        await db.update(invoices).set(baseValues).where(eq(invoices.id, existing.id))
      } else {
        await db.insert(invoices).values(baseValues)
      }
    }
  }

  // 3. Payment failure
  if (event === "payment.failed" && paymentEntity?.id) {
    // No-op for now beyond logging — could trigger an email notification here.
  }

  return res.json({ ok: true })
}
