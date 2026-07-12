import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { payoutRequests, referrals } from "../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../_lib/admin.js"
import { createNotification } from "../../../_lib/notifications.js"

const STATUSES = ["requested", "approved", "paid", "rejected"]
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]", "g")

// Platform-admin updates a payout request's status (manual transfer workflow).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "settings")
  if (!ctx) return
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" })

  const { id } = req.query as { id: string }
  const { status, note } = req.body as { status?: unknown; note?: unknown }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (status !== undefined) {
    if (typeof status !== "string" || !STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status" })
    }
    updates.status = status
  }
  if (note !== undefined && typeof note === "string") updates.note = note.replace(CONTROL, "").slice(0, 300)

  const [row] = await db.update(payoutRequests).set(updates).where(eq(payoutRequests.id, id)).returning()
  if (!row) return res.status(404).json({ error: "Not found" })

  // When a payout is marked paid, mark that referrer's eligible referrals as
  // paid_out so the referrer's UI reflects completion. Status-guarded so a
  // replayed/duplicate admin update can't double-transition.
  if (updates.status === "paid") {
    await db
      .update(referrals)
      .set({ status: "paid_out", updatedAt: new Date() })
      .where(and(eq(referrals.referrerUserId, row.userId), eq(referrals.status, "paid")))
  }

  // Tell the requester how their payout moved (best-effort; account-level).
  // `requested` is the user's own action, so only the admin-driven states notify.
  const notified = updates.status
  if (notified === "approved" || notified === "paid" || notified === "rejected") {
    const payout = `${Number(row.amount).toFixed(2)} ${row.currency}`
    void createNotification({
      userId: row.userId,
      organizationId: null,
      type: "referral_payout",
      title: "Payout update",
      body:
        notified === "paid"
          ? `Your ${payout} payout was sent.`
          : notified === "approved"
            ? `Your ${payout} payout was approved.`
            : `Your ${payout} payout request was declined.`,
      data: {
        i18nKey: "types.referral_payout.title",
        i18nBodyKey: `types.referral_payout.body_${notified}`,
        i18nParams: { amount: payout },
      },
      link: "/referrals",
      dedupeKey: `payout:${row.id}:${notified}`,
    }).catch(() => {})
  }

  return res.json(serialize(row))
}
