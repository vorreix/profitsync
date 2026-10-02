// The Go worker's cron schedules the app depends on, in ONE place. The admin
// Worker panel's register / self-heal (api/_routes/admin/worker.ts) and
// scripts/register-worker-schedules.ts both upsert exactly these, every one of
// them each time: a worker redeploy wipes its whole schedule table, so a repair
// that brought back only one would leave the other silently off (the June '26
// outage). worker/Makefile `register` repeats them in shell — keep it in step.
//
// No imports and no throws at module scope: the registration script runs this
// under plain tsx, without the app's env.

export type WorkerSchedule = {
  name: string
  type: "app.trigger"
  cron: string
  timezone: string
  payload: { path: string }
}

export const WORKER_SCHEDULES: WorkerSchedule[] = [
  // Hourly reconcile sweep for timed notifications: catches anything a lost
  // exact-time enqueue missed (api/_routes/cron/notifications.ts).
  {
    name: "notifications-dispatch",
    type: "app.trigger",
    cron: process.env.NOTIFICATIONS_CRON ?? "0 * * * *",
    timezone: "UTC",
    payload: { path: "/api/cron/notifications" },
  },
  // Daily FX refresh at 16:30 UTC, after the ECB publishes: today's rates plus
  // the history report requests don't top up themselves (api/_routes/cron/fx.ts).
  {
    name: "fx-refresh",
    type: "app.trigger",
    cron: "30 16 * * *",
    timezone: "UTC",
    payload: { path: "/api/cron/fx" },
  },
]
