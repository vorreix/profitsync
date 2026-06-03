import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { referralSettings } from "../../../src/lib/db/schema.js"
import { requireAdmin } from "../../_lib/admin.js"
import { getReferralSettings } from "../../_lib/referral.js"

// ASCII control + Unicode bidi/zero-width/format chars — the banner renders to
// every user, so strip anything that enables bidi/invisible-text spoofing.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]", "g")
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    return res.json(serialize(await getReferralSettings()))
  }

  if (req.method === "PATCH") {
    await getReferralSettings() // ensure the row exists
    const b = req.body as Record<string, unknown>
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (b.reward_type !== undefined && (b.reward_type === "percent" || b.reward_type === "fixed")) updates.rewardType = b.reward_type
    if (b.reward_percent !== undefined) updates.rewardPercent = String(num(b.reward_percent, 0, 100, 25))
    if (b.reward_amount !== undefined) updates.rewardAmount = String(num(b.reward_amount, 0, 1_000_000, 0))
    if (b.reward_currency !== undefined && typeof b.reward_currency === "string") updates.rewardCurrency = b.reward_currency.slice(0, 3).toUpperCase()
    if (b.holding_days !== undefined) updates.holdingDays = Math.round(num(b.holding_days, 0, 365, 14))
    if (b.min_payout !== undefined) updates.minPayout = String(num(b.min_payout, 0, 1_000_000, 0))
    if (b.banner_enabled !== undefined) updates.bannerEnabled = !!b.banner_enabled
    if (b.banner_text !== undefined && typeof b.banner_text === "string") updates.bannerText = b.banner_text.replace(CONTROL, "").slice(0, 300)

    const [row] = await db.update(referralSettings).set(updates).where(eq(referralSettings.id, "default")).returning()
    return res.json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
