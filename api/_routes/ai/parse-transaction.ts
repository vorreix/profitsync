import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import {
  aiCapabilities,
  baseCost,
  creditCosts,
  ensureCreditState,
  maxAudioB64,
  parseTransaction,
  refundAiCredits,
  reserveAiCredits,
  settleTokenSurcharge,
  tokenPolicy,
  tokenSurcharge,
  type ParseInput,
} from "../../_lib/ai.js"
import { getOrgPlan } from "../../_lib/quota.js"

// ~1.5 MB of base64 ≈ 1.1 MB image — generous after the client's ≤1568px
// downscale (typically 150–400 KB) while bounding request size.
const MAX_IMAGE_B64 = 1_500_000
const MAX_TEXT = 1_000
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
// The client always transcodes recordings to 16 kHz mono WAV (see
// src/lib/audio-wav.ts); the rest of the list covers Gemini's accepted set in
// case a future client sends compressed audio directly.
const AUDIO_TYPES = ["audio/wav", "audio/mp3", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac"] as const

// POST /api/ai/parse-transaction — NL text, receipt image and/or a voice
// recording → structured transaction fields. Guards: auth → role → capability
// → quota. Quota is consumed only on a successful parse; the audio payload cap
// is per-plan (free 30 s / premium 60 s ceilings enforced by size).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(ctx.role)) return res.status(403).json({ error: "Insufficient permissions" })

  const caps = aiCapabilities()
  if (!caps.enabled) return res.status(503).json({ error: "AI features are not configured" })

  const { planKey, limits } = await getOrgPlan(ctx.orgId)
  const limit = limits.aiCredits

  const body = (req.body ?? {}) as {
    text?: unknown
    image?: { data?: unknown; media_type?: unknown }
    audio?: { data?: unknown; media_type?: unknown }
  }
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : undefined

  const readPart = (
    part: { data?: unknown; media_type?: unknown } | undefined,
    types: readonly string[],
    maxB64: number,
  ): { data: string; media_type: string } | null | "invalid" => {
    if (part == null) return null
    const { data, media_type } = part
    if (
      typeof data !== "string" || data.length === 0 || data.length > maxB64 ||
      typeof media_type !== "string" || !types.includes(media_type)
    ) return "invalid"
    return { data, media_type }
  }

  const image = readPart(body.image, IMAGE_TYPES, MAX_IMAGE_B64)
  if (image === "invalid") return res.status(400).json({ error: "Invalid image" })
  const audio = readPart(body.audio, AUDIO_TYPES, maxAudioB64(planKey, "quickadd"))
  if (audio === "invalid") return res.status(400).json({ error: "Invalid audio" })
  if (audio && !caps.voice) return res.status(400).json({ error: "Voice input is not supported by the configured AI provider" })
  if (!text?.trim() && !image && !audio) return res.status(400).json({ error: "text, image or audio is required" })

  // Media (receipt/voice) costs more than text; the token surcharge for
  // outlier calls settles AFTER success. Reservation of the base is one
  // atomic conditional UPDATE against the org's balance.
  const cost = baseCost("quickadd", Boolean(image || audio), creditCosts())
  await ensureCreditState(ctx.orgId, planKey, limit)
  const reserved = await reserveAiCredits(ctx.orgId, cost)
  if (!reserved.ok) {
    return res.status(403).json({ error: "aiCredits", limit, upgradeHint: true })
  }

  try {
    const input: ParseInput = { text, image: image ?? undefined, audio: audio ?? undefined }
    const { totalTokens, ...result } = await parseTransaction(ctx.orgId, input)
    const extra = tokenSurcharge("quickadd", totalTokens, tokenPolicy())
    const remaining = extra > 0 ? await settleTokenSurcharge(ctx.orgId, extra) : reserved.balance
    return res.json({ ...result, remaining })
  } catch (err) {
    await refundAiCredits(ctx.orgId, cost).catch(() => undefined)
    if ((err as { code?: string }).code === "unparseable") {
      return res.status(422).json({ error: "unparseable" })
    }
    console.error("ai parse failed", err)
    return res.status(502).json({ error: "AI parsing failed" })
  }
}
