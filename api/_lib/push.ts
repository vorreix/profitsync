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
import { pushSubscriptions } from "../../src/lib/db/schema.js"

export type PushPayload = { title: string; body?: string; url?: string; tag?: string }

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
 * Send a push to every web_push subscription a user has registered. Dead
 * endpoints (404/410) are pruned. Never throws — push is best-effort.
 */
export async function sendWebPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!isWebPushConfigured()) return
  let subs
  try {
    subs = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.channel, "web_push")))
  } catch {
    return
  }
  if (subs.length === 0) return

  let webpush: typeof WebPushType
  try {
    webpush = await getWebPush()
  } catch {
    return
  }

  const body = JSON.stringify(payload)
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {})
        }
      }
    }),
  )
}
