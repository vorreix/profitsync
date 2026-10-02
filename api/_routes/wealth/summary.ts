import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { buildWealthSummary } from "../../_lib/wealth-summary.js"
import { materializeDueRecurring } from "../../_lib/recurring-materialize.js"
import { syncCards } from "../../_lib/card-autopay.js"

/**
 * GET /api/wealth/summary — the consolidated wealth picture (native per-currency
 * totals + reporting-currency equivalents + net worth, with rate dates and an
 * explicit `complete` flag).
 *
 * It posts due recurring rows and runs card autopay first, the same two steps
 * as GET /api/wealth/accounts (MC-161): a summary read before today's rent
 * posts would show net worth from before it while the tiles beside it show the
 * balance after. Both steps are idempotent, so a second run is a cheap no-op —
 * but two runs IN PARALLEL can race (the insert's loser may read balances just
 * before the winner's UPDATE lands), so a screen that shows both waits for the
 * accounts first (useConsolidatedWealth's `enabled`). Hence ALWAYS_FETCH.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  await materializeDueRecurring(ctx.orgId)
  await syncCards(ctx.orgId).catch((err) => console.error("[cards] sync failed", err))
  return res.json(await buildWealthSummary(ctx.orgId))
}
