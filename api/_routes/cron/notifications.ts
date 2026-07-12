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
import { broadcasts, notificationSchedulerState } from "../../../src/lib/db/schema.js"
import { requireServiceToken } from "../../_lib/auth.js"
import { deliverBroadcast } from "../../_lib/broadcast-deliver.js"
import { nextRecurringFire } from "../../../src/lib/schedule-notifications.js"
import type { BroadcastAudience, BroadcastSchedule, BroadcastStats } from "../../../src/lib/types.js"

/** Run one scheduler tick. Exported so the admin "Run due now" route can reuse it. */
export async function runNotificationTick(
  now: Date = new Date(),
): Promise<{ reminders: number; broadcasts: number; previousTickAt: string | null }> {
  // V6: the tick no longer delivers reminders (kept in the return shape for
  // response/panel compatibility — always 0 now).
  const firedReminders = 0
  let firedBroadcasts = 0

  // Read the heartbeat BEFORE this tick overwrites it. Callers use its age to
  // detect a dead PRIMARY scheduler: the GitHub fallback goes red when the
  // previous tick is older than the worker's cadence should ever allow.
  let previousTickAt: string | null = null
  try {
    const [state] = await db
      .select()
      .from(notificationSchedulerState)
      .where(eq(notificationSchedulerState.id, "default"))
    previousTickAt = state?.lastTickAt ? state.lastTickAt.toISOString() : null
  } catch {
    /* observability only — never fail the tick */
  }

  // ── Reminders ────────────────────────────────────────────────────────────────
  // V6: personal reminders are delivered ON the phone via OS-scheduled local
  // notifications (src/lib/native-reminders.ts) — exact device time, offline-
  // capable, no server clock. The DB rows remain the SETTINGS store (web
  // management + cross-device sync); the tick no longer delivers them, so
  // `firedReminders` stays 0 and `last_fired_at` is dormant.

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

  return { reminders: firedReminders, broadcasts: firedBroadcasts, previousTickAt }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!requireServiceToken(req, res)) return
  try {
    const { previousTickAt, ...processed } = await runNotificationTick()
    return res.json({
      ok: true,
      processed,
      previous_tick_at: previousTickAt,
      previous_tick_age_seconds: previousTickAt
        ? Math.round((Date.now() - new Date(previousTickAt).getTime()) / 1000)
        : null,
    })
  } catch (err) {
    console.error("[cron/notifications] tick failed", err)
    return res.status(500).json({ error: "Tick failed" })
  }
}
