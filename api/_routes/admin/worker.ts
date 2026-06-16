import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAdminCap } from "../../_lib/admin.js"

// Admin-only proxy to the background worker's observability API. The worker's
// bearer token (WORKER_API_TOKEN) is held server-side and NEVER sent to the
// browser; the worker need not be publicly exposed beyond this egress.
//   GET  /api/admin/worker            → { configured, reachable, counts, jobs, schedules, schedulesSupported }
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const ctx = await requireAdminCap(req, res, "read")
    if (!ctx) return
    if (!configured()) return res.json({ configured: false, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false })
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
      if (!stats.ok || !jobs.ok) return res.status(502).json({ configured: true, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false })
      return res.json({
        configured: true,
        reachable: true,
        counts: stats.json.counts ?? {},
        jobs: jobs.json.jobs ?? [],
        schedules: schedules.ok ? (schedules.json.schedules ?? []) : [],
        schedulesSupported: schedules.ok,
      })
    } catch {
      return res.status(502).json({ configured: true, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false })
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
