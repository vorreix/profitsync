import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { sendWebPushToUser } from "../../_lib/push.js"

// Diagnostic: send a real web push to the calling user's own devices and return
// the precise outcome, so a user (or admin) can tell exactly WHY a push did or
// did not pop up — without reading server logs. Bypasses the preference cascade
// (it's an explicit, user-initiated action), but the OS-level push permission +
// an actual browser subscription still apply (that's the point of the test).
//
//   POST /api/notifications/test-push
//     → { configured, subscriptions, ok, failed, pruned, errors }
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const result = await sendWebPushToUser(
    ctx.userId,
    {
      title: "ProfitSync test notification",
      body: "If you can see this, push notifications are working on this device. 🎉",
      url: "/notifications",
      tag: "ps-test-push",
    },
    "test",
  )
  return res.json(result)
}
