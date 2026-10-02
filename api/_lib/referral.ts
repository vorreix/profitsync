import { and, eq, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  organizations,
  payoutRequests,
  referralCodes,
  referralSettings,
  referrals,
} from "../../src/lib/db/schema.js"
import { createNotification } from "./notifications.js"
import { isCurrencyCode, normalizeCurrencyCode } from "../../src/lib/money.js"

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

    const credited = await db
      .update(referrals)
      .set({
        status: "paid",
        organizationId: orgId,
        rewardAmount: String(amount),
        // Currency must match the currency `amount` is denominated in: a FIXED
        // reward is in the program's rewardCurrency; a PERCENT reward is a share of
        // the payment, so it's in the payment's currency (e.g. an INR charge → an
        // INR reward, not USD). Mislabeling silently corrupts the payout total.
        rewardCurrency:
          settings.rewardType === "fixed"
            ? settings.rewardCurrency || "USD"
            : paymentCurrency || settings.rewardCurrency || "USD",
        rewardType: settings.rewardType,
        rewardPercent: settings.rewardType === "percent" ? settings.rewardPercent : null,
        paidAt: now,
        qualifyingAt,
        updatedAt: now,
      })
      // Guard on the current status so concurrent/replayed events credit once.
      .where(and(eq(referrals.id, ref.id), eq(referrals.status, "signed_up")))
      .returning({ id: referrals.id })

    // Tell the referrer their reward is on its way — only when THIS call won the
    // status-guarded transition (a replayed webhook/reconcile returns no row).
    // Account-level (orgId null): the referrer isn't a member of the referred org.
    if (credited.length > 0) {
      const rewardCurrency =
        settings.rewardType === "fixed"
          ? settings.rewardCurrency || "USD"
          : paymentCurrency || settings.rewardCurrency || "USD"
      const reward = `${amount.toFixed(2)} ${rewardCurrency}`
      void createNotification({
        userId: ref.referrerUserId,
        organizationId: null,
        type: "referral_credited",
        title: "Referral reward credited",
        body: `Your referral upgraded — ${reward} is on its way.`,
        data: {
          i18nKey: "types.referral_credited.title",
          i18nBodyKey: "types.referral_credited.body",
          i18nParams: { amount: reward },
        },
        link: "/referrals",
        dedupeKey: `ref_credited:${ref.id}`,
      }).catch(() => {})
    }
  } catch {
    /* never break billing on a referral hiccup */
  }
}

/** One currency's referral money. Rewards are snapshotted in the currency they
 *  were earned in (a percent reward in the payment's currency, a fixed one in the
 *  programme's), so a balance only ever adds amounts of ONE currency. */
export type ReferralBalance = {
  currency: string
  lifetimeEarned: number
  eligibleEarned: number
  /** Every live claim on the balance: requested + approved + paid payouts. */
  outstanding: number
  /** Claimed but not sent yet: requested + approved. */
  pending: number
  available: number
}

export type ReferralStats = {
  signups: number
  paid: number
  /** One balance per reward currency, largest available first. */
  balances: ReferralBalance[]
} & ReferralBalance // the flat legacy fields = balances[0] (store-pinned native builds read only these)

const cents = (n: number) => Math.round(n * 100) / 100

/**
 * Group earnings and payout claims by currency — never add across currencies.
 * They used to be summed raw and labelled with the programme currency, so
 * INR 249.75 + USD 2.50 read "Available $252.25" and a USD 252.25 payout passed
 * the balance check (MC-005). Pure — the SQL only feeds it per-currency sums.
 */
export function referralBalances(
  earned: { currency: string; lifetime: number; eligible: number }[],
  claimed: { currency: string; outstanding: number; pending: number }[],
): ReferralBalance[] {
  const by = new Map<string, ReferralBalance>()
  const at = (raw: string) => {
    const currency = raw.trim().toUpperCase()
    let b = by.get(currency)
    if (!b) by.set(currency, (b = { currency, lifetimeEarned: 0, eligibleEarned: 0, outstanding: 0, pending: 0, available: 0 }))
    return b
  }
  for (const e of earned) {
    const b = at(e.currency)
    b.lifetimeEarned += e.lifetime
    b.eligibleEarned += e.eligible
  }
  for (const c of claimed) {
    const b = at(c.currency)
    b.outstanding += c.outstanding
    b.pending += c.pending
  }
  return [...by.values()]
    // A signed_up referral carries the column default currency and no money —
    // it must not conjure an empty balance.
    .filter((b) => b.lifetimeEarned > 0 || b.outstanding > 0)
    .map((b) => ({
      currency: b.currency,
      lifetimeEarned: cents(b.lifetimeEarned),
      eligibleEarned: cents(b.eligibleEarned),
      outstanding: cents(b.outstanding),
      pending: cents(b.pending),
      available: Math.max(0, cents(b.eligibleEarned - b.outstanding)),
    }))
    .sort((a, b) => b.available - a.available || b.lifetimeEarned - a.lifetimeEarned || a.currency.localeCompare(b.currency))
}

// All money is computed server-side, per currency. `available` = eligible (past
// holding) earnings minus everything already requested/approved/paid out.
// Eligible counts `paid_out` referrals too: a paid payout is already subtracted
// as a claim, so dropping its referrals from the earnings as well took it off
// twice and swallowed every later reward.
export async function computeStats(userId: string): Promise<ReferralStats> {
  const [earnedRows, claimedRows] = await Promise.all([
    db
      .select({
        currency: referrals.rewardCurrency,
        signups: sql<number>`count(*)::int`,
        paid: sql<number>`count(*) filter (where ${referrals.status} in ('paid','paid_out'))::int`,
        lifetime: sql<string>`coalesce(sum(case when ${referrals.status} in ('paid','paid_out') then ${referrals.rewardAmount}::numeric else 0 end), 0)`,
        eligible: sql<string>`coalesce(sum(case when ${referrals.status} in ('paid','paid_out') and ${referrals.qualifyingAt} <= now() then ${referrals.rewardAmount}::numeric else 0 end), 0)`,
      })
      .from(referrals)
      .where(eq(referrals.referrerUserId, userId))
      .groupBy(referrals.rewardCurrency),
    db
      .select({
        currency: payoutRequests.currency,
        outstanding: sql<string>`coalesce(sum(case when ${payoutRequests.status} in ('requested','approved','paid') then ${payoutRequests.amount}::numeric else 0 end), 0)`,
        pending: sql<string>`coalesce(sum(case when ${payoutRequests.status} in ('requested','approved') then ${payoutRequests.amount}::numeric else 0 end), 0)`,
      })
      .from(payoutRequests)
      .where(eq(payoutRequests.userId, userId))
      .groupBy(payoutRequests.currency),
  ])

  const balances = referralBalances(
    earnedRows.map((r) => ({ currency: r.currency, lifetime: Number(r.lifetime), eligible: Number(r.eligible) })),
    claimedRows.map((r) => ({ currency: r.currency, outstanding: Number(r.outstanding), pending: Number(r.pending) })),
  )
  // Nothing earned yet: an empty balance in the programme currency, guarded so
  // an old client's unguarded Intl formatter can never be handed a bad code.
  let primary = balances[0]
  if (!primary) {
    const settings = await getReferralSettings()
    const currency = isCurrencyCode(settings.rewardCurrency) ? normalizeCurrencyCode(settings.rewardCurrency) : "USD"
    primary = { currency, lifetimeEarned: 0, eligibleEarned: 0, outstanding: 0, pending: 0, available: 0 }
  }
  return {
    signups: earnedRows.reduce((n, r) => n + Number(r.signups), 0),
    paid: earnedRows.reduce((n, r) => n + Number(r.paid), 0),
    balances,
    ...primary,
  }
}
