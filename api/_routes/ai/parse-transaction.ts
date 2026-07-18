import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { aiEnabled, checkAiQuota, parseTransaction, recordAiUse, type ParseInput } from "../../_lib/ai.js"

// ~1.5 MB of base64 ≈ 1.1 MB image — generous after the client's ≤1568px
// downscale (typically 150–400 KB) while bounding request size.
const MAX_IMAGE_B64 = 1_500_000
const MAX_TEXT = 1_000
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

// POST /api/ai/parse-transaction — NL text and/or receipt image → structured
// transaction fields. Guards: auth → role → quota → availability. Quota is
// consumed only on a successful parse.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(ctx.role)) return res.status(403).json({ error: "Insufficient permissions" })
  if (!aiEnabled()) return res.status(503).json({ error: "AI features are not configured" })

  const quota = await checkAiQuota(ctx.orgId)
  if (!quota.allowed) {
    return res.status(403).json({ error: quota.reason, limit: quota.limit, upgradeHint: quota.upgradeHint })
  }

  const body = (req.body ?? {}) as { text?: unknown; image?: { data?: unknown; media_type?: unknown } }
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : undefined
  let image: ParseInput["image"]
  if (body.image != null) {
    const data = body.image.data
    const mediaType = body.image.media_type
    if (
      typeof data !== "string" || data.length === 0 || data.length > MAX_IMAGE_B64 ||
      typeof mediaType !== "string" || !IMAGE_TYPES.includes(mediaType as (typeof IMAGE_TYPES)[number])
    ) {
      return res.status(400).json({ error: "Invalid image" })
    }
    image = { data, media_type: mediaType as (typeof IMAGE_TYPES)[number] }
  }
  if (!text?.trim() && !image) return res.status(400).json({ error: "text or image is required" })

  try {
    const result = await parseTransaction(ctx.orgId, { text, image })
    await recordAiUse(ctx.orgId)
    const remaining = Math.max(0, (quota.remaining ?? 1) - 1)
    return res.json({ ...result, remaining })
  } catch (err) {
    if ((err as { code?: string }).code === "unparseable") {
      return res.status(422).json({ error: "unparseable" })
    }
    console.error("ai parse failed", err)
    return res.status(502).json({ error: "AI parsing failed" })
  }
}
