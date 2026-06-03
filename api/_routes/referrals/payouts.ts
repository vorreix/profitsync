import type { VercelRequest, VercelResponse } from "@vercel/node"
import { db, serialize } from "../../../src/lib/db/index.js"
import { payoutRequests } from "../../../src/lib/db/schema.js"
import { getUserId } from "../../_lib/auth.js"
import { computeStats, getReferralSettings } from "../../_lib/referral.js"

const METHODS = ["upi", "paypal", "bank"]
// ASCII control chars + Unicode bidi/zero-width/format chars (text-spoofing safe).
// eslint-disable-next-line no-control-regex
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]", "g")
const clean = (v: unknown, max = 120) => (typeof v === "string" ? v.replace(UNSAFE, "").trim().slice(0, max) : "")

// Request a payout. The amount is validated server-side against the available
// (past-holding, not-yet-requested) balance and the configured minimum — the
// client value is never trusted.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { method, details, amount } = req.body as { method?: unknown; details?: Record<string, unknown>; amount?: unknown }
  if (typeof method !== "string" || !METHODS.includes(method)) {
    return res.status(400).json({ error: "Choose a valid payout method" })
  }
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Enter a valid amount" })

  const [settings, stats] = await Promise.all([getReferralSettings(), computeStats(userId)])
  const minPayout = Number(settings.minPayout)
  if (amt < minPayout) return res.status(400).json({ error: `Minimum payout is ${minPayout}` })
  if (amt > stats.available + 0.001) return res.status(400).json({ error: "Amount exceeds your available balance" })

  // Only persist a small, whitelisted set of detail fields, sanitized as text.
  const src = (details && typeof details === "object" ? details : {}) as Record<string, unknown>
  const safeDetails: Record<string, string> = {}
  for (const k of ["upi_id", "paypal_email", "account_name", "account_number", "ifsc", "bank_name", "note"]) {
    if (src[k] !== undefined) safeDetails[k] = clean(src[k])
  }

  // The partial unique index (one pending request per user) makes this insert the
  // atomic guard against concurrent double-spend: a second simultaneous request
  // conflicts and returns nothing.
  const [row] = await db
    .insert(payoutRequests)
    .values({ userId, method, details: safeDetails, amount: String(Math.round(amt * 100) / 100), currency: stats.currency })
    .onConflictDoNothing()
    .returning()
  if (!row) return res.status(409).json({ error: "You already have a pending payout request" })
  return res.status(201).json(serialize(row))
}
