import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { pushSubscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// Register / unregister a Web Push subscription for the calling user.
//   POST   { endpoint, keys: { p256dh, auth }, platform? }  → upsert (by endpoint)
//   DELETE { endpoint }                                      → remove (this user's)
//
// Subscriptions are per-user, not per-org (a device receives a user's pushes
// regardless of active org). The `channel`/`platform` columns leave room for
// future native (fcm/apns) registrations with no schema change.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  if (req.method === "POST") {
    const body = (req.body ?? {}) as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
      platform?: string
    }
    const endpoint = body.endpoint
    const p256dh = body.keys?.p256dh
    const auth = body.keys?.auth
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "Missing endpoint or keys" })
    }
    const platform = typeof body.platform === "string" ? body.platform.slice(0, 20) : "web"
    const userAgent = (req.headers["user-agent"] ?? "").toString().slice(0, 300)

    // Upsert by endpoint: a re-subscribe (e.g. after key rotation or a different
    // user on the same device) rebinds the endpoint to the current user.
    const [existing] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1)
    if (existing) {
      await db
        .update(pushSubscriptions)
        .set({ userId: ctx.userId, channel: "web_push", p256dh, auth, platform, userAgent, lastSeenAt: new Date() })
        .where(eq(pushSubscriptions.id, existing.id))
    } else {
      await db.insert(pushSubscriptions).values({
        userId: ctx.userId,
        channel: "web_push",
        endpoint,
        p256dh,
        auth,
        platform,
        userAgent,
      })
    }
    return res.json({ ok: true })
  }

  if (req.method === "DELETE") {
    const endpoint = (req.body as { endpoint?: string })?.endpoint
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint" })
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, ctx.userId)))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
