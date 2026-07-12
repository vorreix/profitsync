// GET /api/quotations/:id/pdf — the single endpoint the PDF modal polls.
//
// Security: Clerk-authed + org-scoped (an outsider gets 401; a member of
// another org gets 404) + gated behind the business "quotations" feature. The
// bucket is private, so the ONLY way to the bytes is a short-lived presigned URL
// minted HERE — and every call mints a fresh one (default 1h), so a shared link
// dies on its own.
//
// Correctness: the hash of the LIVE snapshot is the cache gate. We serve the
// stored object only when pdf_status === "ready" AND its hash still matches the
// current data; otherwise we (re-)enqueue a render and report "generating".
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { organizations, quotations } from "../../../../src/lib/db/schema.js"
import { requireAuth, requireBusinessFeature } from "../../../_lib/auth.js"
import { getS3Config, isS3Configured, presignGetObject } from "../../../_lib/s3.js"
import { enqueueQuotationPdf, isWorkerConfigured } from "../../../_lib/worker-jobs.js"
import { buildQuotationSnapshot, pdfObjectKey, quotationPdfFilename, snapshotHash } from "../../../_lib/quotation-pdf.js"

const PRESIGN_TTL_SECONDS = 3600 // 1 hour

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { orgId } = ctx
  const { id } = req.query as { id: string }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [row] = await db
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
  if (!row) return res.status(404).json({ error: "Not found" })

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))

  const snapshot = buildQuotationSnapshot(row, org)
  const currentHash = snapshotHash(snapshot)
  const filename = quotationPdfFilename(row)

  // Fresh + ready → mint short-lived presigned URLs and return.
  if (row.pdfStatus === "ready" && row.pdfSourceHash === currentHash && row.pdfObjectKey) {
    if (!isS3Configured()) return res.status(503).json({ status: "unavailable", error: "Storage not configured" })
    const cfg = getS3Config()!
    const viewUrl = presignGetObject(cfg, row.pdfObjectKey, { expiresIn: PRESIGN_TTL_SECONDS, disposition: "inline", filename })
    const downloadUrl = presignGetObject(cfg, row.pdfObjectKey, { expiresIn: PRESIGN_TTL_SECONDS, disposition: "attachment", filename })
    return res.json({
      status: "ready",
      view_url: viewUrl,
      download_url: downloadUrl,
      filename,
      expires_in: PRESIGN_TTL_SECONDS,
      generated_at: row.pdfGeneratedAt ? row.pdfGeneratedAt.toISOString() : null,
      size_bytes: row.pdfSizeBytes,
    })
  }

  // Not generatable without both storage (to serve) and the worker (to render).
  if (!isS3Configured() || !isWorkerConfigured()) {
    return res.status(503).json({ status: "unavailable", error: "PDF generation is not configured" })
  }

  // Enqueue (dedupe by content hash) and mark generating. IMPORTANT: this write
  // must NOT bump updated_at, or the snapshot hash would churn and loop.
  const objectKey = pdfObjectKey(orgId, id, currentHash)
  const enqueued = await enqueueQuotationPdf({
    quotationId: id,
    organizationId: orgId,
    objectKey,
    sourceHash: currentHash,
    snapshot,
  })

  if (row.pdfStatus !== "generating" || row.pdfError) {
    await db
      .update(quotations)
      .set({ pdfStatus: "generating", pdfError: "" })
      .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId)))
  }

  if (!enqueued) {
    return res.status(202).json({ status: "generating", queued: false, note: "Queue unavailable — retrying on next view" })
  }
  return res.status(202).json({ status: "generating", queued: true })
}
