import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import {
  aiCapabilities,
  baseCost,
  creditCosts,
  ensureCreditState,
  maxAudioB64,
  parseAssistant,
  refundAiCredits,
  reserveAiCredits,
  settleTokenSurcharge,
  tokenPolicy,
  tokenSurcharge,
  type ParseInput,
} from "../../_lib/ai.js"
import { getOrgPlan } from "../../_lib/quota.js"
import { db } from "../../../src/lib/db/index.js"
import { aiAsks } from "../../../src/lib/db/schema.js"

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

  const { planKey, limits } = await getOrgPlan(ctx.orgId)
  const limit = limits.aiCredits

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

  const cost = baseCost("assistant", audio != null, creditCosts())
  await ensureCreditState(ctx.orgId, planKey, limit)
  const reserved = await reserveAiCredits(ctx.orgId, cost)
  if (!reserved.ok) {
    return res.status(403).json({ error: "aiCredits", limit, upgradeHint: true })
  }

  try {
    const { totalTokens, ...result } = await parseAssistant(ctx.orgId, { text, audio })
    const extra = tokenSurcharge("assistant", totalTokens, tokenPolicy())
    const remaining = extra > 0 ? await settleTokenSurcharge(ctx.orgId, extra) : reserved.balance
    // Ask log for the USER's history view — never re-read by the model (each
    // ask is parsed fresh; old requests must not skew decisions). Awaited so a
    // serverless freeze after res.json can't silently drop it; a failure is
    // non-fatal (history is a convenience, the parse result matters more).
    // NOTE: transcripts are the user's own speech, stored like the rest of
    // their financial data and deletable from the overlay (per-item + clear).
    try {
      await db.insert(aiAsks).values({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        transcript: result.transcript ?? text?.slice(0, 1000) ?? "",
        intent: result.intent,
        say: result.say ?? "",
      })
    } catch (e) {
      console.error("ai ask log failed", e)
    }
    return res.json({ ...result, remaining })
  } catch (err) {
    await refundAiCredits(ctx.orgId, cost, limit).catch(() => undefined)
    if ((err as { code?: string }).code === "unparseable") {
      return res.status(422).json({ error: "unparseable" })
    }
    console.error("ai assistant failed", err)
    return res.status(502).json({ error: "AI assistant failed" })
  }
}
