/**
 * Idempotently register the worker cron schedule that drives timed notifications.
 *
 * The Go worker is the production scheduler: every ~5 min it POSTs
 * /api/cron/notifications (with the service token) so due reminders + scheduled/
 * recurring broadcasts deliver. This script registers that schedule on the worker
 * once. It is a NO-OP when WORKER_BASE_URL / WORKER_API_TOKEN are unset (e.g. the
 * worker isn't deployed yet) — timed delivery simply stays off until then.
 *
 * Run:  npx tsx scripts/register-worker-schedules.ts
 *       (or: node -r dotenv/config node_modules/.bin/tsx scripts/register-worker-schedules.ts dotenv_config_path=.env.local)
 */

const BASE = process.env.WORKER_BASE_URL?.replace(/\/$/, "")
const TOKEN = process.env.WORKER_API_TOKEN
const CRON = process.env.NOTIFICATIONS_CRON ?? "*/5 * * * *"

const SCHEDULE = {
  name: "notifications-dispatch",
  type: "app.trigger",
  cron: CRON,
  timezone: "UTC",
  payload: { path: "/api/cron/notifications" },
}

async function main() {
  if (!BASE || !TOKEN) {
    console.log("[register-worker-schedules] WORKER_BASE_URL / WORKER_API_TOKEN not set — skipping (timed delivery off).")
    return
  }
  const res = await fetch(`${BASE}/v1/schedules`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(SCHEDULE),
  })
  const text = await res.text()
  if (res.ok) {
    console.log(`[register-worker-schedules] registered "${SCHEDULE.name}" (${CRON}) →`, text || "ok")
  } else if (res.status === 409) {
    console.log(`[register-worker-schedules] "${SCHEDULE.name}" already registered — nothing to do.`)
  } else {
    console.error(`[register-worker-schedules] failed (${res.status}):`, text)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error("[register-worker-schedules] error:", err)
  process.exitCode = 1
})
