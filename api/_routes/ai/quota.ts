import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { aiCapabilities, aiUsageThisMonth, creditCost, maxRecordSeconds } from "../../_lib/ai.js"
import { getOrgPlan } from "../../_lib/quota.js"

// GET /api/ai/quota — availability, capabilities and the org's monthly AI
// CREDIT pool. enabled:false (no provider key configured) hides every AI
// trigger; voice:false (provider without audio input) hides just the mics.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const caps = aiCapabilities()
  if (!caps.enabled) {
    return res.json({
      enabled: false, voice: false, remaining: 0, limit: 0,
      max_record_seconds: 0, assistant_max_record_seconds: 0,
      costs: { quickadd: 1, assistant: 2 }, plan_key: "free",
    })
  }

  const [{ planKey, limits }, used] = await Promise.all([getOrgPlan(ctx.orgId), aiUsageThisMonth(ctx.orgId)])
  const limit = limits.aiParsesPerMonth
  return res.json({
    enabled: true,
    voice: caps.voice,
    remaining: Math.max(0, limit - used),
    limit,
    max_record_seconds: maxRecordSeconds(planKey, "quickadd"),
    assistant_max_record_seconds: maxRecordSeconds(planKey, "assistant"),
    costs: { quickadd: creditCost("quickadd"), assistant: creditCost("assistant") },
    plan_key: planKey,
  })
}
