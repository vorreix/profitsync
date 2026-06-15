// Reminder schedule (#6) — update + delete a single reminder owned by the caller.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { notificationReminders } from "../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../_lib/auth.js"
import { sanitizeReminderSchedule } from "../../../../src/lib/schedule-notifications.js"

const LABEL_MAX = 60

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  const id = single(req.query.id)
  if (!id) return res.status(400).json({ error: "Missing id" })

  // Ownership: only the reminder's owner may touch it.
  const owned = and(eq(notificationReminders.id, id), eq(notificationReminders.userId, ctx.userId))
  const [existing] = await db.select().from(notificationReminders).where(owned).limit(1)
  if (!existing) return res.status(404).json({ error: "Reminder not found" })

  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as { label?: unknown; enabled?: unknown; schedule?: unknown }
    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof body.label === "string") {
      const label = body.label.trim().slice(0, LABEL_MAX)
      if (!label) return res.status(400).json({ error: "A label is required." })
      update.label = label
    }
    if (typeof body.enabled === "boolean") update.enabled = body.enabled
    if (body.schedule !== undefined) {
      const schedule = sanitizeReminderSchedule(body.schedule)
      if (schedule.times.length === 0) return res.status(400).json({ error: "Add at least one time." })
      update.schedule = schedule
    }
    try {
      const [row] = await db.update(notificationReminders).set(update).where(owned).returning()
      return res.json(serialize(row))
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ error: "You already have a reminder with that name." })
      }
      throw err
    }
  }

  if (req.method === "DELETE") {
    await db.delete(notificationReminders).where(owned)
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
