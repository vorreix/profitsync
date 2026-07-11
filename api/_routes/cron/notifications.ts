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
import { broadcasts, notificationReminders, notificationSchedulerState } from "../../../src/lib/db/schema.js"
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
      data: {
        i18nKey: "types.add_transaction_reminder.title",
        i18nBodyKey: "types.add_transaction_reminder.body",
      },
      // Reuse the existing Add-Transaction deep link (?new=1) so clicking the
      // reminder opens the Add Transaction dialog on the Transactions page.
      link: "/transactions?new=1",
      // The user explicitly created this reminder — push it by default (honours
      // mute + an explicit opt-out).
      pushDefault: true,
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
    // Atomically CLAIM the broadcast (scheduled → sending) before delivering.
    // If 0 rows update, it was cancelled or deleted between the select above and
    // now — so a broadcast the admin cancels/deletes right up to its trigger is
    // NEVER sent. The guard is the WHERE status='scheduled'.
    const [claimed] = await db
      .update(broadcasts)
      .set({ status: "sending", updatedAt: now })
      .where(and(eq(broadcasts.id, b.id), eq(broadcasts.status, "scheduled")))
      .returning()
    if (!claimed) continue // cancelled/deleted concurrently → skip

    const schedule = claimed.schedule as BroadcastSchedule
    // Occurrence = this fire's scheduled instant: stable across retries of the
    // same tick, distinct for the next recurrence (so each occurrence delivers).
    const occurrence = (claimed.nextFireAt ?? now).toISOString()
    try {
      const result = await deliverBroadcast(
        {
          id: claimed.id,
          title: claimed.title,
          body: claimed.body,
          imageUrl: claimed.imageUrl,
          link: claimed.link,
          linkType: claimed.linkType,
          category: claimed.category,
          importance: claimed.importance,
          audience: claimed.audience as BroadcastAudience,
        },
        { occurrence },
      )
      const prev = (claimed.stats ?? {}) as BroadcastStats
      const stats: BroadcastStats = { delivered: (prev.delivered ?? 0) + result.delivered }

      if (schedule.type === "recurring") {
        const next = nextRecurringFire(schedule.recurring, claimed.nextFireAt ?? now)
        if (next) {
          // Re-arm for the next occurrence (back to scheduled).
          await db.update(broadcasts).set({ status: "scheduled", nextFireAt: next, stats, sentAt: now, updatedAt: now }).where(eq(broadcasts.id, claimed.id))
        } else {
          await db.update(broadcasts).set({ status: "sent", nextFireAt: null, sentAt: now, stats, updatedAt: now }).where(eq(broadcasts.id, claimed.id))
        }
      } else {
        await db.update(broadcasts).set({ status: "sent", nextFireAt: null, sentAt: now, stats, updatedAt: now }).where(eq(broadcasts.id, claimed.id))
      }
      firedBroadcasts++
    } catch (err) {
      // Delivery failed — re-arm so the next tick retries (per-user dedupe makes
      // re-delivery safe). Never leave it stuck in 'sending'.
      console.error("[cron/notifications] broadcast delivery failed", claimed.id, err)
      await db.update(broadcasts).set({ status: "scheduled", updatedAt: now }).where(eq(broadcasts.id, claimed.id))
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────
  // Recorded on EVERY tick (even zero-work ones) so liveness is observable in
  // the admin Worker panel. Best-effort: a heartbeat failure must never fail
  // the tick itself.
  try {
    await db
      .insert(notificationSchedulerState)
      .values({ id: "default", lastTickAt: now, lastReminders: firedReminders, lastBroadcasts: firedBroadcasts, updatedAt: now })
      .onConflictDoUpdate({
        target: notificationSchedulerState.id,
        set: { lastTickAt: now, lastReminders: firedReminders, lastBroadcasts: firedBroadcasts, updatedAt: now },
      })
  } catch (err) {
    console.error("[cron/notifications] heartbeat write failed", err)
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
