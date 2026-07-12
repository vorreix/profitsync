import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { sendWebPushToUser } from "../../_lib/push.js"
import { isFcmConfigured, sendFcmToUser } from "../../_lib/push-fcm.js"

// Diagnostic: send a real push to the calling user's own devices — web AND
// native (FCM) — and return the merged outcome, so a user (or admin) can tell
// exactly WHY a push did or did not pop up without reading server logs.
// Bypasses the preference cascade (it's an explicit, user-initiated action),
// but the OS-level push permission + an actual device registration still apply
// (that's the point of the test).
//
//   POST /api/notifications/test-push
//     → { configured, subscriptions, ok, failed, pruned, errors }
//       (configured = ANY channel configured; counts summed across channels)
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const payload = {
    title: "ProfitSync test notification",
    body: "If you can see this, push notifications are working on this device. 🎉",
    url: "/notifications",
    tag: "ps-test-push",
  }
  const [web, fcm] = await Promise.all([
    sendWebPushToUser(ctx.userId, payload, "test"),
    isFcmConfigured()
      ? sendFcmToUser(ctx.userId, payload, "test")
      : Promise.resolve({ configured: false, subscriptions: 0, ok: 0, failed: 0, pruned: 0, errors: [] }),
  ])
  return res.json({
    configured: web.configured || fcm.configured,
    subscriptions: web.subscriptions + fcm.subscriptions,
    ok: web.ok + fcm.ok,
    failed: web.failed + fcm.failed,
    pruned: web.pruned + fcm.pruned,
    errors: [...new Set([...web.errors, ...fcm.errors])],
  })
}
