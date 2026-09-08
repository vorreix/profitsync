import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { isViewWindow, todayUtc, type ViewWindow } from "../../../src/lib/budget.js"
import { analyticsFor } from "../../_lib/spending-budgets.js"

/** How many past windows the trend covers, per view. Enough to see a habit, few enough to read. */
const DEFAULT_BACK: Record<ViewWindow, number> = { daily: 14, weekly: 8, monthly: 6, yearly: 3 }
const MAX_BACK = 24

/**
 * GET /api/spending-budgets/analytics?view=monthly&back=6
 *
 * How the money actually went: every past window against the limit that applied
 * then, what each budget took, what no budget covers, and whether the plan is
 * being kept. Strictly READ-ONLY — it materialises nothing. (It still revalidates
 * on every read: ALWAYS_FETCH matches by prefix, so `/api/spending-budgets/…`
 * inherits it. That is harmless here, and correct for a figure about now.)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const view: ViewWindow = isViewWindow(req.query.view) ? req.query.view : "monthly"
  const asked = Number(req.query.back)
  const back = Number.isFinite(asked) && asked >= 2 ? Math.min(MAX_BACK, Math.floor(asked)) : DEFAULT_BACK[view]

  return res.json(await analyticsFor(ctx.orgId, todayUtc(), view, back))
}
