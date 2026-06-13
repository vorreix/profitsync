import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { billingAttempts } from "../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../_lib/admin.js"
import { effectiveStatus, FOLLOW_UP_STATUSES, type FollowUpStatus } from "../../../_lib/billing-attempts.js"

/**
 * PATCH /api/admin/billing-attempts/:id — admin follow-up bookkeeping only
 * (status + free-text notes). The attempt lifecycle itself is written by the
 * billing code paths, never edited by hand.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdminCap(req, res, "write")
  if (!admin) return
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" })

  const { id } = req.query as { id: string }
  const { follow_up_status, follow_up_notes } = req.body as {
    follow_up_status?: string
    follow_up_notes?: string
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (follow_up_status !== undefined) {
    if (!FOLLOW_UP_STATUSES.includes(follow_up_status as FollowUpStatus)) {
      return res.status(400).json({ error: `follow_up_status must be one of: ${FOLLOW_UP_STATUSES.join(", ")}` })
    }
    updates.followUpStatus = follow_up_status
  }
  if (follow_up_notes !== undefined) {
    if (typeof follow_up_notes !== "string") return res.status(400).json({ error: "follow_up_notes must be a string" })
    updates.followUpNotes = follow_up_notes.trim().slice(0, 4000)
  }
  if (Object.keys(updates).length === 1) return res.status(400).json({ error: "Nothing to update" })

  const [updated] = await db
    .update(billingAttempts)
    .set(updates)
    .where(eq(billingAttempts.id, id))
    .returning()
  if (!updated) return res.status(404).json({ error: "Not found" })

  return res.json(serialize({ ...updated, effectiveStatus: effectiveStatus(updated.status, updated.createdAt, new Date()) }))
}
