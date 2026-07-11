import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { pushSubscriptions } from "../../../../src/lib/db/schema.js"

// Endpoint rotation from the service worker's `pushsubscriptionchange` event.
//
// UNAUTHENTICATED by design: the event fires inside the SW where no Clerk
// session is available. Authorization is the OLD endpoint itself — an
// unguessable capability URL known only to this browser and our DB. The rotate
// can only retarget the row that exact endpoint identifies (same user binding),
// so the worst a forged request can do is... nothing, without a valid stored
// endpoint. This is the standard pattern for pushsubscriptionchange handlers.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const body = (req.body ?? {}) as {
    old_endpoint?: string
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  }
  const oldEndpoint = typeof body.old_endpoint === "string" ? body.old_endpoint : ""
  const endpoint = body.subscription?.endpoint
  const p256dh = body.subscription?.keys?.p256dh
  const auth = body.subscription?.keys?.auth
  if (!oldEndpoint || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Missing old_endpoint or subscription" })
  }

  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, oldEndpoint))
    .limit(1)
  // Unknown old endpoint → nothing to rotate. 200 (not 404) so the SW never
  // retries; the next authenticated page load re-syncs via
  // ensureSubscriptionSynced anyway.
  if (!row) return res.json({ ok: false })

  await db
    .update(pushSubscriptions)
    .set({ endpoint, p256dh, auth, lastSeenAt: new Date() })
    .where(eq(pushSubscriptions.id, row.id))
  return res.json({ ok: true })
}
