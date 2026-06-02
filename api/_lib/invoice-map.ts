import type { DodoPayment } from "./dodo.js"

/**
 * Pure mapping from Dodo payments to our invoice rows. Kept free of any database
 * import so the logic is unit-testable in isolation (the DB-touching upsert lives
 * in billing-sync.ts).
 */

/** Map a Dodo payment status onto our internal invoice status enum. */
export function invoiceStatusForPayment(paymentStatus: string): string {
  switch (paymentStatus) {
    case "succeeded":
      return "paid"
    case "failed":
      return "uncollectible"
    case "cancelled":
      return "void"
    default:
      // processing / requires_* etc. — money not yet captured.
      return "open"
  }
}

export type InvoiceRowValues = {
  organizationId: string
  subscriptionId: string
  amount: string
  currency: string
  status: string
  provider: "dodo"
  providerInvoiceId: string
  pdfUrl: string | null
  issuedAt: Date
  paidAt: Date | null
}

/** Build the invoice row values for a single Dodo payment. */
export function invoiceValuesFromPayment(
  payment: DodoPayment,
  ctx: { organizationId: string; subscriptionId: string },
): InvoiceRowValues {
  const status = invoiceStatusForPayment(payment.status)
  const issuedAt = payment.created_at ? new Date(payment.created_at) : new Date()
  return {
    organizationId: ctx.organizationId,
    subscriptionId: ctx.subscriptionId,
    amount: String((payment.total_amount ?? 0) / 100),
    currency: payment.currency || "USD",
    status,
    provider: "dodo",
    providerInvoiceId: payment.payment_id,
    // Leave pdfUrl null: the invoice-pdf route proxies the document through our
    // API key (Dodo's invoice URL isn't an unauthenticated public link).
    pdfUrl: null,
    issuedAt,
    paidAt: status === "paid" ? issuedAt : null,
  }
}
