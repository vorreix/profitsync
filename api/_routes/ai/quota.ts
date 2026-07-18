import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { aiEnabled, aiUsageThisMonth } from "../../_lib/ai.js"
import { getOrgPlan } from "../../_lib/quota.js"

// GET /api/ai/quota — availability + remaining monthly AI parses for the org.
// enabled:false (key not configured) hides the SmartAddBar entirely.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  if (!aiEnabled()) return res.json({ enabled: false, remaining: 0, limit: 0, plan_key: "free" })

  const [{ planKey, limits }, used] = await Promise.all([getOrgPlan(ctx.orgId), aiUsageThisMonth(ctx.orgId)])
  const limit = limits.aiParsesPerMonth
  return res.json({ enabled: true, remaining: Math.max(0, limit - used), limit, plan_key: planKey })
}
