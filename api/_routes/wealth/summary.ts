import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { buildWealthSummary } from "../../_lib/wealth-summary.js"

/**
 * GET /api/wealth/summary — the consolidated wealth picture (native per-currency
 * totals + reporting-currency equivalents + net worth, with rate dates and an
 * explicit `complete` flag). Read-only; it never materialises money.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  return res.json(await buildWealthSummary(ctx.orgId))
}
