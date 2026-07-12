// /api/quotations/:id/pdf — the PDF modal's endpoint.
//
//   GET  → READ-ONLY. Returns the quotation's PDF history (newest 5 ready PDFs,
//          each with fresh presigned view/download URLs) + whether one is being
//          generated + whether the latest is stale vs the live content. It NEVER
//          enqueues a render — opening the modal no longer hits the worker.
//   POST → explicit Generate/Regenerate. Creates a new generation (unique S3
//          key), enqueues the worker, and returns 202. Deduped to one in-flight
//          generation per quotation.
//
// Security: Clerk-authed + org-scoped (outsider → 401; other-org member → 404) +
// gated behind the business "quotations" feature. The bucket is private, so the
// only path to the bytes is a short-lived presigned URL minted HERE.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { organizations, quotationPdfs, quotations } from "../../../../src/lib/db/schema.js"
import { requireAuth, requireBusinessFeature } from "../../../_lib/auth.js"
import { getS3Config, isS3Configured, presignGetObject } from "../../../_lib/s3.js"
import { enqueueQuotationPdf, isWorkerConfigured } from "../../../_lib/worker-jobs.js"
import { buildQuotationSnapshot, pdfObjectKeyForGeneration, quotationPdfFilename, snapshotHash } from "../../../_lib/quotation-pdf.js"
import { MAX_PDF_HISTORY, isPdfStale } from "../../../../src/lib/quotation-pdf-history.js"

const PRESIGN_TTL_SECONDS = 3600 // 1 hour
// An in-flight "generating" row older than this is treated as dead (worker died
// mid-job) so a fresh Generate isn't blocked forever.
const STALE_GENERATING_MS = 5 * 60 * 1000

const rowTime = (v: Date | null | undefined): number => (v ? new Date(v).getTime() : 0)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { orgId } = ctx
  const { id } = req.query as { id: string }

  // Load the quotation (org-scoped) — the gate for its PDFs.
  const [row] = await db
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
  if (!row) return res.status(404).json({ error: "Not found" })

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const snapshot = buildQuotationSnapshot(row, org)
  const currentHash = snapshotHash(snapshot)
  const filename = quotationPdfFilename(row)

  if (req.method === "GET") return handleGet(res, id, currentHash, filename)
  if (req.method === "POST") return handlePost(res, id, orgId, currentHash, snapshot)
  return res.status(405).json({ error: "Method not allowed" })
}

/** GET — read-only history. Never enqueues. */
async function handleGet(res: VercelResponse, id: string, currentHash: string, filename: string) {
  const workerOk = isWorkerConfigured()

  // Without S3 we can neither presign existing PDFs nor store new ones.
  if (!isS3Configured()) {
    return res.json({ filename, unavailable: true, can_generate: false, generating: false, latest_stale: true, history: [] })
  }
  const cfg = getS3Config()!

  const rows = await db
    .select()
    .from(quotationPdfs)
    .where(eq(quotationPdfs.quotationId, id))
    .orderBy(desc(quotationPdfs.createdAt))

  const ready = rows.filter((r) => r.status === "ready" && r.objectKey)
  const generating = rows.some((r) => r.status === "generating" && Date.now() - rowTime(r.createdAt) < STALE_GENERATING_MS)

  const history = ready.slice(0, MAX_PDF_HISTORY).map((r) => ({
    id: r.id,
    generated_at: r.generatedAt ? r.generatedAt.toISOString() : null,
    size_bytes: r.sizeBytes,
    is_current: r.sourceHash === currentHash,
    view_url: presignGetObject(cfg, r.objectKey, { expiresIn: PRESIGN_TTL_SECONDS, disposition: "inline", filename }),
    download_url: presignGetObject(cfg, r.objectKey, { expiresIn: PRESIGN_TTL_SECONDS, disposition: "attachment", filename }),
  }))

  return res.json({
    filename,
    unavailable: false,
    can_generate: workerOk, // need the worker to render new ones
    generating,
    latest_stale: isPdfStale(ready[0]?.sourceHash ?? null, currentHash),
    history,
  })
}

/** POST — explicit generate / regenerate. */
async function handlePost(res: VercelResponse, id: string, orgId: string, currentHash: string, snapshot: unknown) {
  if (!isS3Configured() || !isWorkerConfigured()) {
    return res.status(503).json({ status: "unavailable", error: "PDF generation is not configured" })
  }

  // Dedupe: one live generation per quotation. Reap stale (dead-worker) rows.
  const generatingRows = await db
    .select()
    .from(quotationPdfs)
    .where(and(eq(quotationPdfs.quotationId, id), eq(quotationPdfs.status, "generating")))
    .orderBy(desc(quotationPdfs.createdAt))
  const live = generatingRows.find((r) => Date.now() - rowTime(r.createdAt) < STALE_GENERATING_MS)
  const stale = generatingRows.filter((r) => r.id !== live?.id)
  if (stale.length) {
    await db.update(quotationPdfs).set({ status: "error", error: "timed out" }).where(inArray(quotationPdfs.id, stale.map((r) => r.id)))
  }
  if (live) return res.status(202).json({ status: "generating", id: live.id })

  // New generation: a UNIQUE key per row so history entries never clobber bytes.
  const genId = randomUUID()
  const objectKey = pdfObjectKeyForGeneration(orgId, id, genId)
  await db.insert(quotationPdfs).values({
    id: genId,
    quotationId: id,
    organizationId: orgId,
    objectKey,
    sourceHash: currentHash,
    status: "generating",
  })

  const enqueued = await enqueueQuotationPdf({ quotationId: id, organizationId: orgId, objectKey, sourceHash: currentHash, snapshot })
  if (!enqueued) {
    // Never rendered — drop the row so it doesn't linger as a dead "generating".
    await db.delete(quotationPdfs).where(eq(quotationPdfs.id, genId))
    return res.status(503).json({ status: "error", error: "Could not start generation — the worker is unavailable. Please try again." })
  }
  return res.status(202).json({ status: "generating", id: genId })
}
