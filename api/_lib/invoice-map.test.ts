import { describe, it, expect } from "vitest"
import { invoiceStatusForPayment, invoiceValuesFromPayment } from "./invoice-map"
import type { DodoPayment } from "./dodo"

describe("invoiceStatusForPayment", () => {
  it("maps succeeded → paid", () => {
    expect(invoiceStatusForPayment("succeeded")).toBe("paid")
  })
  it("maps failed → uncollectible", () => {
    expect(invoiceStatusForPayment("failed")).toBe("uncollectible")
  })
  it("maps cancelled → void", () => {
    expect(invoiceStatusForPayment("cancelled")).toBe("void")
  })
  it("maps in-flight statuses → open", () => {
    for (const s of ["processing", "requires_payment_method", "requires_action", "unknown"]) {
      expect(invoiceStatusForPayment(s)).toBe("open")
    }
  })
})

describe("invoiceValuesFromPayment", () => {
  const ctx = { organizationId: "org-1", subscriptionId: "sub-row-1" }

  it("converts minor units to a decimal amount string and sets paidAt for paid invoices", () => {
    const payment: DodoPayment = {
      payment_id: "pay_123",
      status: "succeeded",
      total_amount: 429, // €4.29 in minor units
      currency: "EUR",
      created_at: "2026-06-01T18:12:20.660Z",
      subscription_id: "sub_abc",
      invoice_id: "inv_1",
      invoice_url: "https://test.dodopayments.com/invoices/payments/pay_123",
    }
    const v = invoiceValuesFromPayment(payment, ctx)
    expect(v.amount).toBe("4.29")
    expect(v.currency).toBe("EUR")
    expect(v.status).toBe("paid")
    expect(v.provider).toBe("dodo")
    expect(v.providerInvoiceId).toBe("pay_123")
    expect(v.organizationId).toBe("org-1")
    expect(v.subscriptionId).toBe("sub-row-1")
    // Never trust Dodo's invoice URL as a public link — we proxy via our API key.
    expect(v.pdfUrl).toBeNull()
    expect(v.issuedAt.toISOString()).toBe("2026-06-01T18:12:20.660Z")
    expect(v.paidAt?.toISOString()).toBe("2026-06-01T18:12:20.660Z")
  })

  it("leaves paidAt null for non-paid payments", () => {
    const payment: DodoPayment = {
      payment_id: "pay_fail",
      status: "failed",
      total_amount: 1000,
      currency: "USD",
      created_at: "2026-06-01T00:00:00.000Z",
      subscription_id: "sub_abc",
    }
    const v = invoiceValuesFromPayment(payment, ctx)
    expect(v.status).toBe("uncollectible")
    expect(v.paidAt).toBeNull()
    expect(v.amount).toBe("10")
  })

  it("defaults amount/currency when fields are missing", () => {
    const payment = { payment_id: "pay_x", status: "succeeded", created_at: "" } as unknown as DodoPayment
    const v = invoiceValuesFromPayment(payment, ctx)
    expect(v.amount).toBe("0")
    expect(v.currency).toBe("USD")
    // Falls back to "now" when created_at is empty (not NaN).
    expect(Number.isNaN(v.issuedAt.getTime())).toBe(false)
  })
})
