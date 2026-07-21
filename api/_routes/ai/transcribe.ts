import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { aiCapabilities, creditBalance, creditCosts, ensureCreditState, maxAudioB64, transcribeAudio } from "../../_lib/ai.js"
import { getOrgPlan } from "../../_lib/quota.js"

// Mirrors the assistant route's accepted set (the client always sends WAV).
const AUDIO_TYPES = ["audio/wav", "audio/mp3", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac"] as const

// Per-user sliding-window limiter. In-memory = per-instance, so it is a
// BACKSTOP against runaway polling, not a hard global cap — the credit gate
// below is what stops strangers using this as a free STT API.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
const hits = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const list = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= MAX_PER_WINDOW) {
    hits.set(userId, list)
    return true
  }
  list.push(now)
  hits.set(userId, list)
  if (hits.size > 2_000) {
    // prune stale users so the map cannot grow unbounded
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
  }
  return false
}

// POST /api/ai/transcribe — live-transcript partials for the voice assistant
// overlay on engines WITHOUT SpeechRecognition (the Android/iOS WebViews).
// Transcription only, no interpretation, no DB writes, and NO credit charge:
// the partials are UX for an ask the user is about to pay for — which is why
// the caller must still be ABLE to afford that ask (credit gate below).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(ctx.role)) return res.status(403).json({ error: "Insufficient permissions" })

  const caps = aiCapabilities()
  if (!caps.enabled || !caps.voice) return res.status(503).json({ error: "Voice transcription is not configured" })
  if (rateLimited(ctx.userId)) return res.status(429).json({ error: "Too many requests" })

  const { planKey, limits } = await getOrgPlan(ctx.orgId)

  const body = (req.body ?? {}) as { audio?: { data?: unknown; media_type?: unknown } }
  const data = body.audio?.data
  const mediaType = body.audio?.media_type
  if (
    typeof data !== "string" || data.length === 0 || data.length > maxAudioB64(planKey, "assistant") ||
    typeof mediaType !== "string" || !AUDIO_TYPES.includes(mediaType as (typeof AUDIO_TYPES)[number])
  ) {
    return res.status(400).json({ error: "Invalid audio" })
  }

  await ensureCreditState(ctx.orgId, planKey, limits.aiCredits)
  if ((await creditBalance(ctx.orgId)) < creditCosts().assistant) {
    return res.status(403).json({ error: "aiCredits", limit: limits.aiCredits, upgradeHint: true })
  }

  try {
    const text = await transcribeAudio({ data, media_type: mediaType })
    return res.json({ text })
  } catch (err) {
    console.error("ai transcribe failed", err)
    return res.status(502).json({ error: "Transcription failed" })
  }
}
