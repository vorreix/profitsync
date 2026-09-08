import type { VercelRequest, VercelResponse } from "@vercel/node"
import { buildAlerts } from "../../src/lib/alerts.js"
import { todayIso } from "../../src/lib/recurring.js"
import { loadAlertData } from "../_lib/alerts.js"
import { requireAuth } from "../_lib/auth.js"

/**
 * GET /api/alerts — what needs the user's attention right now, for the banner
 * carousel in the app shell.
 *
 * READ-ONLY, deliberately and unusually. Every other route that touches this
 * data materialises money on the way past — /api/cards and
 * /api/wealth/accounts run materializeDueRecurring + syncCards, and
 * loadCardSummary files statements. If this one did the same, merely opening
 * the dashboard would post transactions and run autopay as a side effect of
 * drawing a banner.
 * `scripts/check-cache-map.mjs` holds the line: import one of those helpers here
 * and the build fails until /api/alerts is added to ALWAYS_FETCH, which is the
 * moment to stop and reconsider rather than to edit the list.
 *
 * The consequence is that the figures can be a few minutes behind a due
 * occurrence that nothing has materialised yet. That is the right trade: a
 * banner that is briefly quiet about a charge is a smaller fault than a page
 * load that moves money.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const today = todayIso()
  const data = await loadAlertData(ctx.orgId, today)
  const items = buildAlerts({
    today,
    accounts: data.accounts,
    cards: data.cards,
    rules: data.rules,
    posted: data.posted,
    scheduled: data.scheduled,
    alreadyPosted: data.alreadyPosted,
  })
  return res.status(200).json({ items, today })
}
