import { describe, expect, it } from "vitest"
import {
  buildQuotationSnapshot,
  pdfObjectKey,
  quotationPdfFilename,
  quotationReference,
  snapshotHash,
} from "./quotation-pdf.js"

const row = {
  id: "1a2b3c4d-5e6f-7788-99aa-bbccddeeff00",
  title: "Website redesign",
  prospectName: "Jane Doe",
  company: "Acme Inc",
  email: "jane@acme.test",
  phone: "+1 555 0100",
  amount: "1200.5",
  date: "2026-07-01",
  status: "sent",
  notes: "Half upfront.",
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
}
const org = { name: "My Studio", currency: "usd" }

describe("buildQuotationSnapshot", () => {
  it("maps row+org fields and formats the amount with the currency CODE", () => {
    const s = buildQuotationSnapshot(row, org)
    expect(s.org_name).toBe("My Studio")
    expect(s.prospect_name).toBe("Jane Doe")
    expect(s.currency).toBe("USD")
    expect(s.reference).toBe("Q-1A2B3C4D")
    // currencyDisplay:"code" → "USD 1,200.50" (Latin-safe, no symbol tofu).
    expect(s.amount_label).toContain("USD")
    expect(s.amount_label).toContain("1,200.50")
    expect(s.generated_at).toBe("2026-07-10")
  })

  it("falls back gracefully on a missing org / bad currency", () => {
    const s = buildQuotationSnapshot(row, undefined)
    expect(s.currency).toBe("USD")
    expect(s.amount_label).toContain("USD")
    const s2 = buildQuotationSnapshot(row, { name: "X", currency: "ZZZ" })
    expect(s2.amount_label).toContain("ZZZ")
  })
})

describe("snapshotHash", () => {
  it("is deterministic for identical content", () => {
    expect(snapshotHash(buildQuotationSnapshot(row, org))).toBe(snapshotHash(buildQuotationSnapshot(row, org)))
  })

  it("changes when a content field changes", () => {
    const a = snapshotHash(buildQuotationSnapshot(row, org))
    const b = snapshotHash(buildQuotationSnapshot({ ...row, amount: "1300" }, org))
    expect(a).not.toBe(b)
  })

  it("is STABLE when only generated_at (updatedAt) changes — no regeneration loop", () => {
    const a = snapshotHash(buildQuotationSnapshot(row, org))
    const b = snapshotHash(buildQuotationSnapshot({ ...row, updatedAt: new Date("2030-01-01T00:00:00Z") }, org))
    expect(a).toBe(b)
  })

  it("changes when the currency changes", () => {
    const a = snapshotHash(buildQuotationSnapshot(row, org))
    const b = snapshotHash(buildQuotationSnapshot(row, { name: "My Studio", currency: "eur" }))
    expect(a).not.toBe(b)
  })

  it("returns a 64-char hex digest", () => {
    expect(snapshotHash(buildQuotationSnapshot(row, org))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("pdfObjectKey / reference / filename", () => {
  it("builds an org-segmented, hashed key", () => {
    expect(pdfObjectKey("org1", "q1", "deadbeef")).toBe("quotations/org1/q1/deadbeef.pdf")
  })

  it("derives a short uppercase reference from the id", () => {
    expect(quotationReference(row.id)).toBe("Q-1A2B3C4D")
  })

  it("produces a safe download filename", () => {
    expect(quotationPdfFilename(row)).toBe("Quotation-Website redesign.pdf")
    expect(quotationPdfFilename({ id: row.id, title: "  " })).toBe("Quotation-Q-1A2B3C4D.pdf")
    expect(quotationPdfFilename({ id: row.id, title: 'a/b"c<>' })).not.toMatch(/["/<>]/)
  })
})
