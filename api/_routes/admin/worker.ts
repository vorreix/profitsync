import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { notificationSchedulerState, pushEvents } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

// Admin-only proxy to the background worker's observability API. The worker's
// bearer token (WORKER_API_TOKEN) is held server-side and NEVER sent to the
// browser; the worker need not be publicly exposed beyond this egress.
//   GET  /api/admin/worker            → { configured, reachable, counts, jobs, schedules, schedulesSupported, heartbeat }
//   POST /api/admin/worker {action,id} → retry | cancel a job | register-notifications
const BASE = process.env.WORKER_BASE_URL
const TOKEN = process.env.WORKER_API_TOKEN

// The cron schedule that drives timed notifications (reminders + scheduled /
// recurring broadcasts). Mirrors scripts/register-worker-schedules.ts so the
// admin "Repair" button registers exactly the same schedule.
const NOTIFICATIONS_SCHEDULE = {
  name: "notifications-dispatch",
  type: "app.trigger",
  cron: process.env.NOTIFICATIONS_CRON ?? "*/5 * * * *",
  timezone: "UTC",
  payload: { path: "/api/cron/notifications" },
}

function configured(): boolean {
  return !!(BASE && TOKEN)
}

function single(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? ""
}

async function workerFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${BASE!.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        // Bypass ngrok's free-tier browser-warning interstitial (which would
        // return HTML and break JSON parsing). Harmless against a real worker.
        "ngrok-skip-browser-warning": "true",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      json = {}
    }
    return { ok: res.ok, status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

// The scheduler-tick heartbeat lives in OUR db (written by runNotificationTick),
// so it is readable even when the worker itself is down or unconfigured — that
// is the whole point: it proves whether ANY driver (worker or the fallback
// cron) is actually ticking. Best-effort: never let it break the panel.
async function tickHeartbeat(): Promise<Record<string, unknown> | null> {
  try {
    const [row] = await db
      .select()
      .from(notificationSchedulerState)
      .where(eq(notificationSchedulerState.id, "default"))
    return row ? serialize(row) : null
  } catch {
    return null
  }
}

// Recent push fan-out outcomes (push_events, written by sendWebPushToUser) so
// "did the push actually go out, and why not" is answerable from the panel.
async function recentPushEvents(): Promise<Record<string, unknown>[]> {
  try {
    const rows = await db.select().from(pushEvents).orderBy(desc(pushEvents.createdAt)).limit(10)
    return rows.map(serialize)
  } catch {
    return []
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const ctx = await requireAdminCap(req, res, "read")
    if (!ctx) return
    const [heartbeat, push_events] = await Promise.all([tickHeartbeat(), recentPushEvents()])
    if (!configured()) return res.json({ configured: false, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false, heartbeat, push_events })
    try {
      const status = single(req.query.status)
      const type = single(req.query.type)
      const [stats, jobs, schedules] = await Promise.all([
        workerFetch("GET", "/v1/stats"),
        workerFetch("GET", `/v1/jobs?status=${encodeURIComponent(status)}&type=${encodeURIComponent(type)}&limit=50`),
        // GET /v1/schedules is newer than the rest of the panel; an older worker
        // build 404s it. Treat that as "schedules unknown" (schedulesSupported:false)
        // rather than "no schedules" so the UI can prompt a worker rebuild.
        workerFetch("GET", "/v1/schedules").catch(
          () => ({ ok: false, status: 0, json: {} as Record<string, unknown> }),
        ),
      ])
      // Status reports return 200 even when the worker is down — a 502 makes the
      // client's apiGet throw and DROP the payload, hiding the tick heartbeat
      // exactly when it matters most (worker outage).
      if (!stats.ok || !jobs.ok) return res.json({ configured: true, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false, heartbeat, push_events })
      return res.json({
        configured: true,
        reachable: true,
        counts: stats.json.counts ?? {},
        jobs: jobs.json.jobs ?? [],
        schedules: schedules.ok ? (schedules.json.schedules ?? []) : [],
        schedulesSupported: schedules.ok,
        heartbeat,
        push_events,
      })
    } catch {
      return res.json({ configured: true, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false, heartbeat, push_events })
    }
  }

  if (req.method === "POST") {
    const ctx = await requireAdminCap(req, res, "settings")
    if (!ctx) return
    if (!configured()) return res.status(400).json({ error: "Worker not configured" })
    const { action, id } = (req.body ?? {}) as { action?: string; id?: string }

    // Register / repair the notification-dispatch schedule (the cron that makes
    // reminders + scheduled broadcasts fire). Idempotent upsert by name — safe to
    // click repeatedly. No id needed.
    if (action === "register-notifications") {
      try {
        const r = await workerFetch("POST", "/v1/schedules", NOTIFICATIONS_SCHEDULE)
        if (!r.ok) return res.status(r.status).json(r.json)
        return res.json({ ok: true, schedule: NOTIFICATIONS_SCHEDULE.name })
      } catch {
        return res.status(502).json({ error: "Worker unreachable" })
      }
    }

    if (!id || (action !== "retry" && action !== "cancel")) {
      return res.status(400).json({ error: "action (retry|cancel|register-notifications) and id are required" })
    }
    try {
      const r = await workerFetch("POST", `/v1/jobs/${encodeURIComponent(id)}/${action}`)
      if (!r.ok) return res.status(r.status).json(r.json)
      return res.json({ ok: true })
    } catch {
      return res.status(502).json({ error: "Worker unreachable" })
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}
