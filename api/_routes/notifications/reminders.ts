// Reminder schedules (#6) — list + create. Per-USER data (not org-scoped): a
// reminder belongs to the signed-in user; the org context is captured so the
// deep-linked Add-Transaction opens in the right workspace.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { count, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { notificationReminders } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { sanitizeReminderSchedule } from "../../../src/lib/schedule-notifications.js"

const MAX_REMINDERS = 20
const LABEL_MAX = 60

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  if (req.method === "GET") {
    const rows = await db
      .select()
      .from(notificationReminders)
      .where(eq(notificationReminders.userId, ctx.userId))
    rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    return res.json({ reminders: rows.map((r) => serialize(r)) })
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as { label?: unknown; enabled?: unknown; schedule?: unknown }
    const label = typeof body.label === "string" ? body.label.trim().slice(0, LABEL_MAX) : ""
    if (!label) return res.status(400).json({ error: "A label is required." })
    const schedule = sanitizeReminderSchedule(body.schedule)
    if (schedule.times.length === 0) return res.status(400).json({ error: "Add at least one time." })

    const [existing] = await db
      .select({ value: count() })
      .from(notificationReminders)
      .where(eq(notificationReminders.userId, ctx.userId))
    if ((existing?.value ?? 0) >= MAX_REMINDERS) {
      return res.status(403).json({ error: `You can have at most ${MAX_REMINDERS} reminders.` })
    }

    try {
      const [row] = await db
        .insert(notificationReminders)
        .values({
          userId: ctx.userId,
          organizationId: ctx.orgId,
          enabled: body.enabled === false ? false : true,
          label,
          schedule,
        })
        .returning()
      return res.status(201).json(serialize(row))
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ error: "You already have a reminder with that name." })
      }
      throw err
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}
