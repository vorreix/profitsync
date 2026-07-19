import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import {
  aiCapabilities,
  creditCost,
  maxAudioB64,
  parseAssistant,
  refundAiCredits,
  reserveAiCredits,
  type ParseInput,
} from "../../_lib/ai.js"
import { getOrgPlan } from "../../_lib/quota.js"

const MAX_TEXT = 1_000
// The client always transcodes recordings to mono WAV (12 kHz for the
// assistant — see src/lib/audio-wav.ts); the list covers Gemini's accepted set.
const AUDIO_TYPES = ["audio/wav", "audio/mp3", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac"] as const

// POST /api/ai/assistant — the voice assistant: audio (or text) → intent +
// payload. Never writes to the DB; the client routes the result into the
// existing prefilled create dialogs / filtered navigation. Costs
// creditCost("assistant") credits, deducted only on success.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(ctx.role)) return res.status(403).json({ error: "Insufficient permissions" })

  const caps = aiCapabilities()
  if (!caps.enabled) return res.status(503).json({ error: "AI features are not configured" })

  const cost = creditCost("assistant")
  const { planKey, limits } = await getOrgPlan(ctx.orgId)
  const limit = limits.aiParsesPerMonth

  const body = (req.body ?? {}) as { text?: unknown; audio?: { data?: unknown; media_type?: unknown } }
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : undefined
  let audio: ParseInput["audio"]
  if (body.audio != null) {
    const { data, media_type } = body.audio
    if (
      typeof data !== "string" || data.length === 0 || data.length > maxAudioB64(planKey, "assistant") ||
      typeof media_type !== "string" || !AUDIO_TYPES.includes(media_type as (typeof AUDIO_TYPES)[number])
    ) {
      return res.status(400).json({ error: "Invalid audio" })
    }
    audio = { data, media_type }
  }
  if (audio && !caps.voice) return res.status(400).json({ error: "Voice input is not supported by the configured AI provider" })
  if (!text?.trim() && !audio) return res.status(400).json({ error: "text or audio is required" })

  // Reserve credits ATOMICALLY (the WHERE re-checks the limit), then parse;
  // failures refund so a bad recording never burns the pool.
  const reserved = await reserveAiCredits(ctx.orgId, cost, limit)
  if (!reserved.ok) {
    return res.status(403).json({ error: "aiParsesPerMonth", limit, upgradeHint: true })
  }

  try {
    const result = await parseAssistant(ctx.orgId, { text, audio })
    return res.json({ ...result, remaining: reserved.remaining })
  } catch (err) {
    await refundAiCredits(ctx.orgId, cost).catch(() => undefined)
    if ((err as { code?: string }).code === "unparseable") {
      return res.status(422).json({ error: "unparseable" })
    }
    console.error("ai assistant failed", err)
    return res.status(502).json({ error: "AI assistant failed" })
  }
}
