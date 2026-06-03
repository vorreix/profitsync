import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "../../../src/lib/db/index.js"
import { referrals, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

// Platform-admin view of every referral, with referrer/referred emails and the
// amount owed (paid but not yet paid_out).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "read")
  if (!ctx) return
  const adminId = ctx.userId
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const referrer = alias(userProfiles, "referrer")
  const referred = alias(userProfiles, "referred")

  const rows = await db
    .select({
      id: referrals.id,
      status: referrals.status,
      code: referrals.code,
      rewardAmount: referrals.rewardAmount,
      rewardCurrency: referrals.rewardCurrency,
      rewardType: referrals.rewardType,
      qualifyingAt: referrals.qualifyingAt,
      paidAt: referrals.paidAt,
      createdAt: referrals.createdAt,
      referrerUserId: referrals.referrerUserId,
      referrerEmail: referrer.email,
      referredEmail: referred.email,
    })
    .from(referrals)
    .leftJoin(referrer, eq(referrer.id, referrals.referrerUserId))
    .leftJoin(referred, eq(referred.id, referrals.referredUserId))
    .orderBy(desc(referrals.createdAt))
    .limit(500)

  return res.json(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      code: r.code,
      reward_amount: Number(r.rewardAmount),
      reward_currency: r.rewardCurrency,
      reward_type: r.rewardType,
      qualifying_at: r.qualifyingAt,
      paid_at: r.paidAt,
      created_at: r.createdAt,
      referrer_user_id: r.referrerUserId,
      referrer_email: r.referrerEmail,
      referred_email: r.referredEmail,
    })),
  )
}
