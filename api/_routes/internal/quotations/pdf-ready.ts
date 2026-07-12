// POST /api/internal/quotations/pdf-ready — worker → app callback.
//
// The Go worker calls this after uploading a rendered PDF to S3. Authenticated
// by the shared SERVICE token (constant-time compare — same gate as the
// notification cron), never a user session; the browser never calls it. The
// update is id + org scoped, so a callback can only mark the specific
// quotation ready and can't point a foreign row at an attacker's key.
//
// This write sets ONLY the pdf_* columns (+ pdf_generated_at) — it deliberately
// does NOT touch updated_at, because the view route's cache hash is derived from
// content + updated_at; bumping it here would invalidate the very PDF we just
// marked ready.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { quotations } from "../../../../src/lib/db/schema.js"
import { requireServiceToken } from "../../../_lib/auth.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!requireServiceToken(req, res)) return

  const { quotation_id, organization_id, object_key, source_hash, size_bytes } = (req.body ?? {}) as {
    quotation_id?: string
    organization_id?: string
    object_key?: string
    source_hash?: string
    size_bytes?: number
  }
  if (!quotation_id || !object_key) {
    return res.status(400).json({ error: "quotation_id and object_key are required" })
  }

  const where = organization_id
    ? and(eq(quotations.id, quotation_id), eq(quotations.organizationId, organization_id))
    : eq(quotations.id, quotation_id)

  const [updated] = await db
    .update(quotations)
    .set({
      pdfStatus: "ready",
      pdfObjectKey: String(object_key),
      pdfSourceHash: String(source_hash ?? ""),
      pdfSizeBytes: Number.isFinite(Number(size_bytes)) ? Number(size_bytes) : 0,
      pdfGeneratedAt: new Date(),
      pdfError: "",
    })
    .where(where)
    .returning({ id: quotations.id })

  if (!updated) return res.status(404).json({ error: "Not found" })
  return res.json({ ok: true })
}
