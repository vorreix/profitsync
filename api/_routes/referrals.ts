import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { payoutRequests, referrals, userProfiles } from "../../src/lib/db/schema.js"
import { getUserId } from "../_lib/auth.js"
import { computeStats, getOrCreateReferralCode, getReferralSettings } from "../_lib/referral.js"

function maskEmail(email?: string | null): string {
  if (!email) return "Invited user"
  const [name, domain] = email.split("@")
  if (!domain) return "Invited user"
  const head = name.slice(0, 1)
  return `${head}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [code, settings, stats] = await Promise.all([
    getOrCreateReferralCode(userId),
    getReferralSettings(),
    computeStats(userId),
  ])

  const refRows = await db
    .select({
      id: referrals.id,
      status: referrals.status,
      rewardAmount: referrals.rewardAmount,
      rewardCurrency: referrals.rewardCurrency,
      qualifyingAt: referrals.qualifyingAt,
      paidAt: referrals.paidAt,
      createdAt: referrals.createdAt,
      email: userProfiles.email,
      fullName: userProfiles.fullName,
    })
    .from(referrals)
    .leftJoin(userProfiles, eq(userProfiles.id, referrals.referredUserId))
    .where(eq(referrals.referrerUserId, userId))
    .orderBy(desc(referrals.createdAt))
    .limit(200)

  const payouts = await db
    .select()
    .from(payoutRequests)
    .where(eq(payoutRequests.userId, userId))
    .orderBy(desc(payoutRequests.createdAt))
    .limit(50)

  // Was the CURRENT user referred by someone? If so the UI shows "Invited by …"
  // and hides the "Have a referral code?" entry (a code can be applied only once).
  const [referredByRow] = await db
    .select({
      code: referrals.code,
      inviterName: userProfiles.fullName,
      inviterEmail: userProfiles.email,
    })
    .from(referrals)
    .leftJoin(userProfiles, eq(userProfiles.id, referrals.referrerUserId))
    .where(eq(referrals.referredUserId, userId))
    .limit(1)

  return res.json({
    referred_by: referredByRow
      ? { code: referredByRow.code, inviter: referredByRow.inviterName?.trim() || maskEmail(referredByRow.inviterEmail) }
      : null,
    code,
    stats,
    settings: {
      reward_type: settings.rewardType,
      reward_percent: Number(settings.rewardPercent),
      reward_amount: Number(settings.rewardAmount),
      reward_currency: settings.rewardCurrency,
      holding_days: settings.holdingDays,
      min_payout: Number(settings.minPayout),
      banner_enabled: settings.bannerEnabled,
      banner_text: settings.bannerText,
    },
    referrals: refRows.map((r) => ({
      id: r.id,
      status: r.status,
      reward_amount: Number(r.rewardAmount),
      reward_currency: r.rewardCurrency,
      qualifying_at: r.qualifyingAt,
      paid_at: r.paidAt,
      created_at: r.createdAt,
      // Privacy: show a masked label, not the full identity.
      label: r.fullName?.trim() || maskEmail(r.email),
    })),
    payouts: payouts.map(serialize),
  })
}
