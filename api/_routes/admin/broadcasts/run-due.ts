// Admin "Run due now" (#7) — manually drive one scheduler tick from the admin UI,
// so due reminders + scheduled/recurring broadcasts deliver without waiting for the
// worker's cron (useful before the worker is deployed, or for testing). Gated by
// the `broadcast` capability; reuses the exact same idempotent tick the cron runs.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAdminCap } from "../../../_lib/admin.js"
import { runNotificationTick } from "../../cron/notifications.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return
  try {
    const processed = await runNotificationTick()
    return res.json({ ok: true, processed })
  } catch (err) {
    console.error("[admin/broadcasts/run-due] failed", err)
    return res.status(500).json({ error: "Run failed" })
  }
}
