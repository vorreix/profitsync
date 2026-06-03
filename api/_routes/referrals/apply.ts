import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { referralCodes, referrals } from "../../../src/lib/db/schema.js"
import { getUserId } from "../../_lib/auth.js"

// Manually apply a referral code. Allowed only once, never to oneself, and only
// with a valid code.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { code } = req.body as { code?: unknown }
  const clean = typeof code === "string" ? code.trim().toUpperCase() : ""
  if (!clean) return res.status(400).json({ error: "A referral code is required" })

  // Already referred? (one referral per referred user)
  const [existing] = await db.select({ id: referrals.id }).from(referrals).where(eq(referrals.referredUserId, userId))
  if (existing) return res.status(409).json({ error: "A referral code has already been applied to your account" })

  const [cr] = await db.select().from(referralCodes).where(eq(referralCodes.code, clean))
  if (!cr) return res.status(404).json({ error: "That referral code isn't valid" })
  if (cr.userId === userId) return res.status(400).json({ error: "You can't refer yourself" })

  const [row] = await db
    .insert(referrals)
    .values({ referrerUserId: cr.userId, referredUserId: userId, code: clean, status: "signed_up" })
    .onConflictDoNothing()
    .returning({ id: referrals.id })
  if (!row) return res.status(409).json({ error: "A referral code has already been applied to your account" })

  return res.status(201).json({ ok: true })
}
