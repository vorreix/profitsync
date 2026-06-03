import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { payoutRequests, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

// Platform-admin list of all payout requests (manual fulfilment).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "read")
  if (!ctx) return
  const adminId = ctx.userId
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const rows = await db
    .select({
      id: payoutRequests.id,
      userId: payoutRequests.userId,
      method: payoutRequests.method,
      details: payoutRequests.details,
      amount: payoutRequests.amount,
      currency: payoutRequests.currency,
      status: payoutRequests.status,
      note: payoutRequests.note,
      createdAt: payoutRequests.createdAt,
      email: userProfiles.email,
    })
    .from(payoutRequests)
    .leftJoin(userProfiles, eq(userProfiles.id, payoutRequests.userId))
    .orderBy(desc(payoutRequests.createdAt))
    .limit(500)

  return res.json(
    rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      email: r.email,
      method: r.method,
      details: r.details,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      note: r.note,
      created_at: r.createdAt,
    })),
  )
}
