import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAdminCap } from "../../_lib/admin.js"

// Admin-only proxy to the background worker's observability API. The worker's
// bearer token (WORKER_API_TOKEN) is held server-side and NEVER sent to the
// browser; the worker need not be publicly exposed beyond this egress.
//   GET  /api/admin/worker            → { configured, reachable, counts, jobs }
//   POST /api/admin/worker {action,id} → retry | cancel a job
const BASE = process.env.WORKER_BASE_URL
const TOKEN = process.env.WORKER_API_TOKEN

function configured(): boolean {
  return !!(BASE && TOKEN)
}

function single(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? ""
}

async function workerFetch(method: string, path: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
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
      },
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
    if (!configured()) return res.json({ configured: false, reachable: false, counts: {}, jobs: [] })
    try {
      const status = single(req.query.status)
      const type = single(req.query.type)
      const [stats, jobs] = await Promise.all([
        workerFetch("GET", "/v1/stats"),
        workerFetch("GET", `/v1/jobs?status=${encodeURIComponent(status)}&type=${encodeURIComponent(type)}&limit=50`),
      ])
      if (!stats.ok || !jobs.ok) return res.status(502).json({ configured: true, reachable: false, counts: {}, jobs: [] })
      return res.json({
        configured: true,
        reachable: true,
        counts: stats.json.counts ?? {},
        jobs: jobs.json.jobs ?? [],
      })
    } catch {
      return res.status(502).json({ configured: true, reachable: false, counts: {}, jobs: [] })
    }
  }

  if (req.method === "POST") {
    const ctx = await requireAdminCap(req, res, "settings")
    if (!ctx) return
    if (!configured()) return res.status(400).json({ error: "Worker not configured" })
    const { action, id } = (req.body ?? {}) as { action?: string; id?: string }
    if (!id || (action !== "retry" && action !== "cancel")) {
      return res.status(400).json({ error: "action (retry|cancel) and id are required" })
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
