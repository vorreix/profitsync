/**
 * Idempotently register the worker cron schedules the app depends on
 * (api/_lib/worker-schedules.ts — the same list the admin Worker panel repairs):
 *
 *  - notifications-dispatch: scheduled/recurring broadcasts fire via EXACT-TIME
 *    one-shot jobs enqueued at schedule time (api/_lib/worker-jobs.ts); this
 *    HOURLY sweep POSTs /api/cron/notifications (with the service token) as the
 *    reconciler for anything a lost enqueue missed. Personal reminders are
 *    phone-local and no longer server-delivered.
 *  - fx-refresh: the DAILY exchange-rate refresh (/api/cron/fx), the only thing
 *    that fills rate history older than what report requests top up.
 *
 * It is a NO-OP when WORKER_BASE_URL / WORKER_API_TOKEN are unset (e.g. the
 * worker isn't deployed yet).
 *
 * Run:  npx tsx scripts/register-worker-schedules.ts
 *       (or: node -r dotenv/config node_modules/.bin/tsx scripts/register-worker-schedules.ts dotenv_config_path=.env.local)
 */
import { WORKER_SCHEDULES } from "../api/_lib/worker-schedules.js"

const BASE = process.env.WORKER_BASE_URL?.replace(/\/$/, "")
const TOKEN = process.env.WORKER_API_TOKEN

async function main() {
  if (!BASE || !TOKEN) {
    console.log("[register-worker-schedules] WORKER_BASE_URL / WORKER_API_TOKEN not set — skipping (timed delivery off).")
    return
  }
  // Every schedule is tried even when one fails: a wiped table needs them all.
  for (const schedule of WORKER_SCHEDULES) {
    const res = await fetch(`${BASE}/v1/schedules`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    })
    const text = await res.text()
    if (res.ok) {
      console.log(`[register-worker-schedules] registered "${schedule.name}" (${schedule.cron}) →`, text || "ok")
    } else if (res.status === 409) {
      console.log(`[register-worker-schedules] "${schedule.name}" already registered — nothing to do.`)
    } else {
      console.error(`[register-worker-schedules] "${schedule.name}" failed (${res.status}):`, text)
      process.exitCode = 1
    }
  }
}

main().catch((err) => {
  console.error("[register-worker-schedules] error:", err)
  process.exitCode = 1
})
