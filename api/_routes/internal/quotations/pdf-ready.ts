// POST /api/internal/quotations/pdf-ready — worker → app callback.
//
// The Go worker calls this after uploading a rendered PDF to S3. Authenticated by
// the shared SERVICE token (constant-time compare — same gate as the notification
// cron), never a user session; the browser never calls it.
//
// It marks the specific generation (matched by its UNIQUE object_key) ready, then
// prunes the quotation's history to the newest MAX_PDF_HISTORY ready PDFs —
// deleting the older rows and best-effort deleting their S3 objects so the bucket
// doesn't grow unbounded. A callback whose object_key matches no row (a stray/
// legacy job) is a harmless no-op.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { quotationPdfs } from "../../../../src/lib/db/schema.js"
import { requireServiceToken } from "../../../_lib/auth.js"
import { deleteObject, getS3Config, isS3Configured } from "../../../_lib/s3.js"
import { MAX_PDF_HISTORY, partitionPdfHistory } from "../../../../src/lib/quotation-pdf-history.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!requireServiceToken(req, res)) return

  const { object_key, size_bytes } = (req.body ?? {}) as {
    quotation_id?: string
    organization_id?: string
    object_key?: string
    source_hash?: string
    size_bytes?: number
  }
  if (!object_key) return res.status(400).json({ error: "object_key is required" })

  // Match the exact generation by its unique key (the worker echoes back the key
  // we handed it in the enqueue payload).
  const [row] = await db.select().from(quotationPdfs).where(eq(quotationPdfs.objectKey, String(object_key)))
  if (!row) return res.json({ ok: true, note: "no matching generation (ignored)" })

  await db
    .update(quotationPdfs)
    .set({
      status: "ready",
      sizeBytes: Number.isFinite(Number(size_bytes)) ? Number(size_bytes) : 0,
      generatedAt: new Date(),
      error: "",
    })
    .where(eq(quotationPdfs.id, row.id))

  // Prune: keep the newest MAX_PDF_HISTORY ready PDFs for this quotation.
  const readyRows = await db
    .select()
    .from(quotationPdfs)
    .where(and(eq(quotationPdfs.quotationId, row.quotationId), eq(quotationPdfs.status, "ready")))
  const { prune } = partitionPdfHistory(readyRows, MAX_PDF_HISTORY)
  if (prune.length) {
    await db.delete(quotationPdfs).where(inArray(quotationPdfs.id, prune.map((r) => r.id)))
    if (isS3Configured()) {
      const cfg = getS3Config()!
      // Best-effort object cleanup — a failed delete just leaves a brief orphan.
      await Promise.all(prune.filter((r) => r.objectKey).map((r) => deleteObject(cfg, r.objectKey)))
    }
  }

  return res.json({ ok: true })
}
