// /api/quotations/:id/pdf/file — same-origin streaming proxy for a generated PDF.
//
//   GET ?gen=<quotationPdfs.id>[&dl=1] → the PDF bytes, Content-Type
//   application/pdf, disposition inline (default) or attachment (dl=1).
//
// Why this exists: the modal's presigned S3 URLs are CROSS-ORIGIN, which desktop
// browsers happily navigate to, but installed PWAs and the Capacitor WebViews
// restrict (popup sandboxing, ignored cross-origin `download` attributes, no
// WebView download handler). The web/PWA client instead fetches THIS same-origin
// route with its normal Authorization/x-org-id headers and saves the blob —
// identical to the attachment endpoints' pattern (see billing/invoice-pdf.ts).
// The bucket stays private: we mint a short-lived presigned URL server-side and
// relay the bytes; the client never needs bucket CORS.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../../../src/lib/db/index.js"
import { quotationPdfs, quotations } from "../../../../../src/lib/db/schema.js"
import { requireAuth, requireBusinessFeature } from "../../../../_lib/auth.js"
import { getS3Config, presignGetObject } from "../../../../_lib/s3.js"
import { quotationPdfFilename } from "../../../../_lib/quotation-pdf.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { id, gen } = req.query as { id: string; gen?: string }
  if (!gen || !UUID_RE.test(gen)) return res.status(400).json({ error: "gen is required" })

  // Org-scoped quotation gate first (outsider → 404), then the generation row
  // must belong to THAT quotation and be a finished render.
  const [row] = await db
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, ctx.orgId), isNull(quotations.deletedAt)))
  if (!row) return res.status(404).json({ error: "Not found" })

  const [pdf] = await db
    .select()
    .from(quotationPdfs)
    .where(and(eq(quotationPdfs.id, gen), eq(quotationPdfs.quotationId, id)))
  if (!pdf || pdf.status !== "ready" || !pdf.objectKey) return res.status(404).json({ error: "Not found" })

  const cfg = getS3Config()
  if (!cfg) return res.status(503).json({ error: "PDF storage is not configured" })

  const filename = quotationPdfFilename(row)
  const disposition = req.query.dl === "1" ? "attachment" : "inline"

  // Short-lived presign consumed immediately server-side; the client only ever
  // sees the relayed bytes.
  const url = presignGetObject(cfg, pdf.objectKey, { expiresIn: 300, disposition, filename })
  let upstream: Response
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch {
    return res.status(502).json({ error: "Could not fetch the PDF from storage. Please try again." })
  }
  if (!upstream.ok) {
    return res.status(502).json({ error: "Could not fetch the PDF from storage. Please try again." })
  }

  const bytes = Buffer.from(await upstream.arrayBuffer())
  res.setHeader("Content-Type", "application/pdf")
  // Mirror the disposition the presign asked for so browsers treat the blob the
  // same way a direct navigation would.
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`)
  res.setHeader("Content-Length", String(bytes.length))
  res.setHeader("Cache-Control", "private, no-store")
  return res.status(200).send(bytes)
}
