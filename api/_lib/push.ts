// Web Push delivery (optional enhancement channel).
//
// Entirely best-effort and isolated: if VAPID env is absent, every function here
// no-ops, so the in-app notification path NEVER depends on push. `web-push` is
// imported LAZILY (dynamic import inside the sender) so it is not pulled in at
// module scope — keeping cold starts light and the boot-functions prod-parity
// check from ever loading it.
//
// Future native channels (fcm/apns for android/ios/wearables) plug in here:
// add a sender keyed off push_subscriptions.channel — no schema/API change.
import type * as WebPushType from "web-push"
import { and, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { pushEvents, pushSubscriptions } from "../../src/lib/db/schema.js"

export type PushPayload = { title: string; body?: string; url?: string; tag?: string; image?: string }

/**
 * Outcome of a push fan-out to one user — returned so a caller (e.g. the
 * /api/notifications/test-push diagnostic) can surface exactly WHY a push did or
 * did not reach the device. Event-source callers (createNotification) ignore it
 * and stay fire-and-forget.
 */
export type PushSendResult = {
  /** VAPID keys present server-side (precondition for any web push). */
  configured: boolean
  /** How many web_push subscriptions this user has registered. */
  subscriptions: number
  /** Sends accepted by the push service. */
  ok: number
  /** Sends rejected (non-404/410). */
  failed: number
  /** Dead endpoints (404/410) removed during this send. */
  pruned: number
  /** Distinct error summaries (e.g. "403", "send error") for diagnostics. */
  errors: string[]
}

/** True when VAPID keys are configured — the precondition for any web push. */
export function isWebPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

let vapidSet = false
async function getWebPush(): Promise<typeof WebPushType> {
  const mod = (await import("web-push")) as unknown as { default?: typeof WebPushType } & typeof WebPushType
  const webpush = mod.default ?? mod
  if (!vapidSet) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:support@profitsync.app",
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    )
    vapidSet = true
  }
  return webpush
}

/**
 * Persist the outcome of a fan-out so admins can see whether pushes go out and
 * why they fail (push_events, surfaced in /admin → Worker). Fire-and-forget:
 * logging can never affect delivery. Shared with the FCM sender (push-fcm.ts).
 */
export function logPushEvent(userId: string, source: string, r: PushSendResult): void {
  const outcome = !r.configured
    ? "unconfigured"
    : r.subscriptions === 0
      ? "no_subs"
      : r.failed === 0 && r.ok > 0
        ? "ok"
        : r.ok > 0
          ? "partial"
          : "failed"
  void db
    .insert(pushEvents)
    .values({
      userId,
      source,
      outcome,
      subscriptions: r.subscriptions,
      ok: r.ok,
      failed: r.failed,
      pruned: r.pruned,
      errors: r.errors.join(",").slice(0, 300),
    })
    .catch(() => {})
}

/**
 * Send a push to every web_push subscription a user has registered. Dead
 * endpoints (404/410) are pruned. Never throws — push is best-effort.
 * `source` (a notification type, or "test") is recorded in the push_events log.
 */
export async function sendWebPushToUser(userId: string, payload: PushPayload, source = ""): Promise<PushSendResult> {
  const result = await doSendWebPush(userId, payload)
  logPushEvent(userId, source, result)
  return result
}

async function doSendWebPush(userId: string, payload: PushPayload): Promise<PushSendResult> {
  const result: PushSendResult = { configured: true, subscriptions: 0, ok: 0, failed: 0, pruned: 0, errors: [] }
  if (!isWebPushConfigured()) {
    console.warn("[push] skipped: VAPID not configured (set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)")
    return { ...result, configured: false }
  }
  let subs
  try {
    subs = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.channel, "web_push")))
  } catch (err) {
    console.error("[push] failed to load subscriptions", { userId, err: String(err) })
    return { ...result, errors: ["load_failed"] }
  }
  result.subscriptions = subs.length
  if (subs.length === 0) {
    console.log("[push] no web_push subscriptions for user (device not opted in?)", { userId })
    return result
  }

  let webpush: typeof WebPushType
  try {
    webpush = await getWebPush()
  } catch (err) {
    console.error("[push] web-push module/VAPID init failed", { err: String(err) })
    return { ...result, errors: ["vapid_init_failed"] }
  }

  const body = JSON.stringify(payload)
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        result.ok++
      } catch (err) {
        result.failed++
        const code = (err as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          result.pruned++
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {})
        } else {
          const summary = code ? String(code) : String((err as Error)?.message ?? err).slice(0, 60)
          if (!result.errors.includes(summary)) result.errors.push(summary)
          console.error("[push] send error", { userId, statusCode: code, err: String((err as Error)?.message ?? err) })
        }
      }
    }),
  )
  console.log("[push] delivered", { userId, subscriptions: subs.length, ok: result.ok, failed: result.failed, pruned: result.pruned })
  return result
}
