import { and, eq, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  organizations,
  payoutRequests,
  referralCodes,
  referralSettings,
  referrals,
} from "../../src/lib/db/schema.js"

const SETTINGS_ID = "default"

export type ReferralSettings = typeof referralSettings.$inferSelect

// Read the single settings row, creating defaults on first access.
export async function getReferralSettings(): Promise<ReferralSettings> {
  const [row] = await db.select().from(referralSettings).where(eq(referralSettings.id, SETTINGS_ID))
  if (row) return row
  await db
    .insert(referralSettings)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing()
  const [created] = await db.select().from(referralSettings).where(eq(referralSettings.id, SETTINGS_ID))
  return created
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function genCode(): string {
  let s = ""
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return s
}

// Idempotently get (or create) the user's referral code.
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const [existing] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId))
  if (existing) return existing.code
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genCode()
    const [row] = await db.insert(referralCodes).values({ userId, code }).onConflictDoNothing().returning()
    if (row) return row.code
    // A conflict occurred — either the user already has a code (race) or the
    // code collided. Resolve by userId; if that's empty it was a code collision.
    const [now] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId))
    if (now) return now.code
  }
  throw new Error("Failed to allocate referral code")
}

// Attribute a newly-signed-up user to a referrer by code. No-ops on: empty/unknown
// code, self-referral, or an already-referred user (unique referred_user_id).
export async function attributeReferral(referredUserId: string, rawCode: string | undefined | null): Promise<void> {
  if (!rawCode || typeof rawCode !== "string") return
  const code = rawCode.trim().toUpperCase()
  if (!code) return
  const [cr] = await db.select().from(referralCodes).where(eq(referralCodes.code, code))
  if (!cr) return
  if (cr.userId === referredUserId) return // no self-referral
  await db
    .insert(referrals)
    .values({ referrerUserId: cr.userId, referredUserId, code, status: "signed_up" })
    .onConflictDoNothing()
}

// Credit the referrer when a referred user's org makes its first payment. The
// reward is snapshotted from settings at this moment. Idempotent: only a
// `signed_up` referral transitions to `paid` (the WHERE guard prevents
// double-crediting on renewals / replayed webhooks).
export async function creditReferralOnPaid(orgId: string, paymentAmount: number, paymentCurrency?: string): Promise<void> {
  try {
    const [org] = await db.select({ owner: organizations.ownerUserId }).from(organizations).where(eq(organizations.id, orgId))
    if (!org?.owner) return
    const [ref] = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.referredUserId, org.owner), eq(referrals.status, "signed_up")))
    if (!ref) return

    const settings = await getReferralSettings()
    const amount =
      settings.rewardType === "fixed"
        ? Number(settings.rewardAmount)
        : Math.round((Number(settings.rewardPercent) / 100) * (paymentAmount || 0) * 100) / 100
    const now = new Date()
    const qualifyingAt = new Date(now.getTime() + Number(settings.holdingDays) * 86_400_000)

    await db
      .update(referrals)
      .set({
        status: "paid",
        organizationId: orgId,
        rewardAmount: String(amount),
        rewardCurrency: settings.rewardCurrency || paymentCurrency || "USD",
        rewardType: settings.rewardType,
        rewardPercent: settings.rewardType === "percent" ? settings.rewardPercent : null,
        paidAt: now,
        qualifyingAt,
        updatedAt: now,
      })
      // Guard on the current status so concurrent/replayed events credit once.
      .where(and(eq(referrals.id, ref.id), eq(referrals.status, "signed_up")))
  } catch {
    /* never break billing on a referral hiccup */
  }
}

export type ReferralStats = {
  signups: number
  paid: number
  lifetimeEarned: number
  eligibleEarned: number
  outstanding: number
  available: number
  currency: string
}

// All money is computed server-side. `available` = eligible (past holding)
// earnings minus everything already requested/approved/paid out.
export async function computeStats(userId: string): Promise<ReferralStats> {
  const settings = await getReferralSettings()

  const [counts] = await db
    .select({
      signups: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) filter (where ${referrals.status} in ('paid','paid_out'))::int`,
      lifetime: sql<string>`coalesce(sum(case when ${referrals.status} in ('paid','paid_out') then ${referrals.rewardAmount}::numeric else 0 end), 0)`,
      eligible: sql<string>`coalesce(sum(case when ${referrals.status} = 'paid' and ${referrals.qualifyingAt} <= now() then ${referrals.rewardAmount}::numeric else 0 end), 0)`,
    })
    .from(referrals)
    .where(eq(referrals.referrerUserId, userId))

  const [payoutAgg] = await db
    .select({
      outstanding: sql<string>`coalesce(sum(case when ${payoutRequests.status} in ('requested','approved','paid') then ${payoutRequests.amount}::numeric else 0 end), 0)`,
    })
    .from(payoutRequests)
    .where(eq(payoutRequests.userId, userId))

  const eligible = Number(counts?.eligible ?? 0)
  const outstanding = Number(payoutAgg?.outstanding ?? 0)
  return {
    signups: Number(counts?.signups ?? 0),
    paid: Number(counts?.paid ?? 0),
    lifetimeEarned: Number(counts?.lifetime ?? 0),
    eligibleEarned: eligible,
    outstanding,
    available: Math.max(0, Math.round((eligible - outstanding) * 100) / 100),
    currency: settings.rewardCurrency,
  }
}
