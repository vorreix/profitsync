import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { invoices, subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { defaultDodoEnv, fetchInvoicePdf, isDodoConfigured, type DodoEnv } from "../../_lib/dodo.js"

/**
 * Stream a Dodo-generated invoice PDF for one of the active org's invoices.
 * `GET /api/billing/invoice-pdf?id=<invoiceId>` — the invoice id is OUR row id;
 * we resolve the Dodo payment id from it (org-scoped, so a user can only fetch
 * invoices that belong to their workspace) and proxy the PDF without ever
 * exposing the Dodo API key to the browser. If a direct pdf_url is stored, we
 * redirect to it instead.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const id = req.query.id as string | undefined
  if (!id) return res.status(400).json({ error: "id is required" })

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.orgId)))
  if (!invoice) return res.status(404).json({ error: "Invoice not found" })

  // If a hosted PDF URL is stored, hand it back so the client can open it
  // directly (an authenticated XHR can't transparently follow a cross-origin
  // redirect, so we return JSON rather than a 302).
  if (invoice.pdfUrl) {
    return res.json({ url: invoice.pdfUrl })
  }

  if (invoice.provider !== "dodo" || !invoice.providerInvoiceId) {
    return res.status(404).json({ error: "No downloadable invoice document is available yet." })
  }

  // The invoice's Dodo environment is whatever its subscription was created in.
  const [sub] = invoice.subscriptionId
    ? await db.select().from(subscriptions).where(eq(subscriptions.id, invoice.subscriptionId))
    : []
  const env = (sub?.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
  if (!isDodoConfigured(env)) {
    return res.status(404).json({ error: "No downloadable invoice document is available yet." })
  }

  try {
    const pdf = await fetchInvoicePdf(invoice.providerInvoiceId, env)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename="invoice-${invoice.id}.pdf"`)
    return res.status(200).send(pdf)
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch invoice" })
  }
}
