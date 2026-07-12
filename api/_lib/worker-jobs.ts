// Exact-time scheduler jobs (V6, branch notif6-02).
//
// Instead of a 5-minute polling cron, every scheduled/recurring broadcast
// enqueues ONE one-shot job on the Go worker at its exact fire time
// (`POST /v1/jobs` with run_at + dedupe_key — natively supported by the
// worker's queue). The job simply triggers the idempotent notification tick,
// so a stale job (edited/cancelled broadcast) fires a harmless no-op — no
// cancel plumbing needed. The worker's hourly `notifications-dispatch` sweep
// is the reconciler for anything a lost enqueue missed (worker down at
// schedule time, redeploy wiped the queue): dedupe keys make overlap safe.
//
// BEST-EFFORT by design: an enqueue failure logs and returns false — the
// sweep will deliver at worst ~an hour late, and the money path (the admin
// mutation that scheduled the broadcast) never fails because of the worker.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).

const TICK_PATH = "/api/cron/notifications"

export function isWorkerConfigured(): boolean {
  return !!(process.env.WORKER_BASE_URL && process.env.WORKER_API_TOKEN)
}

/**
 * Enqueue an exact-time tick on the worker. `occurrenceKey` identifies the
 * (broadcast, occurrence) pair — the worker keeps at most one live job per
 * key, so re-saves and races collapse. Returns true when the worker accepted
 * (or already had) the job.
 */
export async function enqueueNotificationTickAt(runAt: Date, occurrenceKey: string): Promise<boolean> {
  if (!isWorkerConfigured()) return false
  try {
    const res = await fetch(`${process.env.WORKER_BASE_URL}/v1/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "app.trigger",
        run_at: runAt.toISOString(),
        dedupe_key: `tick:${occurrenceKey}`,
        payload: { path: TICK_PATH },
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.warn("[worker-jobs] enqueue rejected", { status: res.status, occurrenceKey })
      return false
    }
    return true
  } catch (err) {
    console.warn("[worker-jobs] enqueue failed (hourly sweep will cover)", {
      occurrenceKey,
      err: String((err as Error)?.message ?? err),
    })
    return false
  }
}
