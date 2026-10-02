import { describe, it, expect } from "vitest"
import { invoiceStatusForPayment, invoiceValuesFromPayment } from "./invoice-map"
import { fromDodoMinor, type DodoPayment } from "./dodo"

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

describe("Dodo amounts are in the currency's smallest unit, not always cents", () => {
  it("fromDodoMinor divides by 10^minorUnits: JPY 0, USD 2, KWD 3", () => {
    expect(fromDodoMinor(1500, "JPY")).toBe(1500)
    expect(fromDodoMinor(499, "USD")).toBe(4.99)
    expect(fromDodoMinor(3010, "KWD")).toBe(3.01)
    expect(fromDodoMinor(3015, "kwd")).toBe(3.015)
    expect(fromDodoMinor(undefined, "USD")).toBe(0)
  })

  it("stores a ¥1,500 charge as 1500 and a 3.010 KWD charge as 3.01, not 15 and 30.1", () => {
    const base = { status: "succeeded", created_at: "2026-06-01T00:00:00.000Z", subscription_id: "sub_abc" }
    const ctx = { organizationId: "org-1", subscriptionId: "sub-row-1" }
    expect(invoiceValuesFromPayment({ ...base, payment_id: "p1", total_amount: 1500, currency: "JPY" }, ctx).amount).toBe("1500")
    expect(invoiceValuesFromPayment({ ...base, payment_id: "p2", total_amount: 3010, currency: "KWD" }, ctx).amount).toBe("3.01")
    expect(invoiceValuesFromPayment({ ...base, payment_id: "p3", total_amount: 499, currency: "USD" }, ctx).amount).toBe("4.99")
  })
})
