// Shared contract between the app and the Go worker for quotation PDFs.
//
// The APP is the single source of truth for the object key + the content hash:
// it builds a data snapshot, hashes the content-bearing fields, and derives a
// stable S3 key `quotations/<org>/<quote>/<hash>.pdf`. The worker just renders
// the snapshot and uploads to that exact key. On every view the app re-derives
// the hash from live data and only serves the stored object when it still
// matches — so editing a quotation silently invalidates its PDF and triggers a
// fresh render, with no explicit cache-busting.
//
// Node-only (node:crypto) — lives in api/_lib so it never reaches the browser
// bundle. Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import { createHash } from "node:crypto"

/** Exactly the shape the worker's quotationSnapshot unmarshals (snake_case). */
export interface QuotationPdfSnapshot {
  org_name: string
  org_email: string
  reference: string
  title: string
  prospect_name: string
  company: string
  email: string
  phone: string
  amount_label: string
  currency: string
  amount: string
  date: string
  status: string
  notes: string
  /** Display-only footer stamp — EXCLUDED from the content hash. */
  generated_at: string
}

/** Minimal row/org shapes we read — kept loose to avoid importing Drizzle types. */
interface QuotationRowLike {
  id: string
  title?: string | null
  prospectName?: string | null
  company?: string | null
  email?: string | null
  phone?: string | null
  amount?: string | null
  date?: string | null
  status?: string | null
  notes?: string | null
  updatedAt?: Date | string | null
}
interface OrgLike {
  name?: string | null
  currency?: string | null
}

/**
 * Format the amount using the currency CODE (not symbol) on purpose: maroto's
 * built-in fonts are Latin-1, so "INR 1,200.00" always renders while "₹" would
 * be a tofu box. Symbol rendering arrives with the embedded-Noto follow-up.
 */
function formatAmountLabel(amount: string, currency: string): string {
  const n = Number(amount ?? "0")
  const code = (currency || "USD").toUpperCase()
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
    }).format(Number.isFinite(n) ? n : 0)
  } catch {
    // Unknown/invalid currency code → plain "CODE 1200.00".
    return `${code} ${(Number.isFinite(n) ? n : 0).toFixed(2)}`
  }
}

/** A short, human-friendly reference derived from the quotation id. */
export function quotationReference(id: string): string {
  return "Q-" + id.replace(/-/g, "").slice(0, 8).toUpperCase()
}

/** Build the render snapshot from a quotation row + its org. */
export function buildQuotationSnapshot(q: QuotationRowLike, org: OrgLike | undefined): QuotationPdfSnapshot {
  const currency = (org?.currency || "USD").toUpperCase()
  const amount = String(q.amount ?? "0")
  const updated = q.updatedAt ? new Date(q.updatedAt) : null
  return {
    org_name: (org?.name ?? "").trim(),
    org_email: "",
    reference: quotationReference(q.id),
    title: (q.title ?? "").trim(),
    prospect_name: (q.prospectName ?? "").trim(),
    company: (q.company ?? "").trim(),
    email: (q.email ?? "").trim(),
    phone: (q.phone ?? "").trim(),
    amount_label: formatAmountLabel(amount, currency),
    currency,
    amount,
    date: (q.date ?? "").toString(),
    status: (q.status ?? "").toString(),
    notes: (q.notes ?? "").trim(),
    generated_at: updated ? updated.toISOString().slice(0, 10) : "",
  }
}

/**
 * SHA-256 of the content-bearing fields in a FIXED order. `generated_at` is
 * excluded so a cosmetic footer stamp never forces a re-render. Any change to
 * the visible content flips the hash → new key → regeneration.
 */
export function snapshotHash(s: QuotationPdfSnapshot): string {
  const material = [
    s.org_name,
    s.reference,
    s.title,
    s.prospect_name,
    s.company,
    s.email,
    s.phone,
    s.amount_label,
    s.currency,
    s.amount,
    s.date,
    s.status,
    s.notes,
  ]
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex")
}

/** Stable, org-segmented object key. Org segment is defence-in-depth against */
/** key-guessing; the real gate is the org-scoped auth on the presign route. */
export function pdfObjectKey(orgId: string, quotationId: string, hash: string): string {
  return `quotations/${orgId}/${quotationId}/${hash}.pdf`
}

/**
 * Per-generation object key — UNIQUE per PDF (keyed by the `quotation_pdfs` row
 * id), so every Generate/Regenerate produces a distinct S3 object and history
 * entries never overwrite each other's bytes. (The content-hash `pdfObjectKey`
 * above only survives via rows backfilled from the old single-value columns.)
 */
export function pdfObjectKeyForGeneration(orgId: string, quotationId: string, generationId: string): string {
  return `quotations/${orgId}/${quotationId}/gen-${generationId}.pdf`
}

/** A friendly download filename, e.g. "Quotation-Q-1A2B3C4D.pdf". */
export function quotationPdfFilename(q: QuotationRowLike): string {
  const base = (q.title && q.title.trim()) || quotationReference(q.id)
  const safe = base.replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
  return `Quotation-${safe || quotationReference(q.id)}.pdf`
}
