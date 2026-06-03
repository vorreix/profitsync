import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { payoutRequests } from "../../../../src/lib/db/schema.js"
import { requireAdmin } from "../../../_lib/admin.js"

const STATUSES = ["requested", "approved", "paid", "rejected"]
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]", "g")

// Platform-admin updates a payout request's status (manual transfer workflow).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return
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
  return res.json(serialize(row))
}
