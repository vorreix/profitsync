// Scheduler-agnostic notification tick (#6 reminders + #7 scheduled broadcasts).
//
// Authenticated by the shared service token, NOT a user session — the browser
// never calls this. The Go worker's cron drives it every ~5 min in production
// (app.trigger → { path: "/api/cron/notifications" }); an external pinger
// (GitHub Actions / cron-job.org) or the admin "Run due now" button can drive the
// exact same logic. Idempotent: every notification it creates carries a dedupeKey,
// so a double-tick or retry never double-sends.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, lte } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { broadcasts, notificationReminders } from "../../../src/lib/db/schema.js"
import { requireServiceToken } from "../../_lib/auth.js"
import { createNotification } from "../../_lib/notifications.js"
import { deliverBroadcast } from "../../_lib/broadcast-deliver.js"
import { nextRecurringFire, reminderDueSlot } from "../../../src/lib/schedule-notifications.js"
import type { BroadcastAudience, BroadcastSchedule, BroadcastStats, ReminderSchedule } from "../../../src/lib/types.js"

/** Run one scheduler tick. Exported so the admin "Run due now" route can reuse it. */
export async function runNotificationTick(now: Date = new Date()): Promise<{ reminders: number; broadcasts: number }> {
  let firedReminders = 0
  let firedBroadcasts = 0

  // ── Due reminders ──────────────────────────────────────────────────────────
  const reminders = await db.select().from(notificationReminders).where(eq(notificationReminders.enabled, true))
  for (const r of reminders) {
    const slot = reminderDueSlot(r.schedule as ReminderSchedule, now, r.lastFiredAt ?? null)
    if (!slot) continue
    await createNotification({
      userId: r.userId,
      organizationId: r.organizationId ?? null,
      type: "add_transaction_reminder",
      title: "Time to add your transactions",
      body: "Don't forget to record today's income and expenses.",
      data: { i18nKey: "types.add_transaction_reminder" },
      link: "/transactions?add=1",
      dedupeKey: `reminder:${r.id}:${slot}`,
    })
    await db
      .update(notificationReminders)
      .set({ lastFiredAt: now, updatedAt: now })
      .where(eq(notificationReminders.id, r.id))
    firedReminders++
  }

  // ── Due scheduled / recurring broadcasts ─────────────────────────────────────
  const due = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.nextFireAt, now)))
  for (const b of due) {
    const result = await deliverBroadcast({
      id: b.id,
      title: b.title,
      body: b.body,
      imageUrl: b.imageUrl,
      link: b.link,
      linkType: b.linkType,
      category: b.category,
      importance: b.importance,
      audience: b.audience as BroadcastAudience,
    })
    const prev = (b.stats ?? {}) as BroadcastStats
    const stats: BroadcastStats = { delivered: (prev.delivered ?? 0) + result.delivered }

    const schedule = b.schedule as BroadcastSchedule
    if (schedule.type === "recurring") {
      const next = nextRecurringFire(schedule.recurring, b.nextFireAt ?? now)
      if (next) {
        await db.update(broadcasts).set({ nextFireAt: next, stats, sentAt: now, updatedAt: now }).where(eq(broadcasts.id, b.id))
      } else {
        await db
          .update(broadcasts)
          .set({ status: "sent", nextFireAt: null, sentAt: now, stats, updatedAt: now })
          .where(eq(broadcasts.id, b.id))
      }
    } else {
      await db
        .update(broadcasts)
        .set({ status: "sent", nextFireAt: null, sentAt: now, stats, updatedAt: now })
        .where(eq(broadcasts.id, b.id))
    }
    firedBroadcasts++
  }

  return { reminders: firedReminders, broadcasts: firedBroadcasts }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!requireServiceToken(req, res)) return
  try {
    const processed = await runNotificationTick()
    return res.json({ ok: true, processed })
  } catch (err) {
    console.error("[cron/notifications] tick failed", err)
    return res.status(500).json({ error: "Tick failed" })
  }
}
