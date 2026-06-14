// Admin broadcast (#7) — send a draft/scheduled broadcast immediately. Fans out
// via the shared deliverer; idempotent per recipient (dedupe key), so re-sending
// only reaches users it hasn't reached for this broadcast id.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../../../src/lib/db/index.js"
import { broadcasts } from "../../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../../_lib/admin.js"
import { deliverBroadcast } from "../../../../_lib/broadcast-deliver.js"
import type { BroadcastAudience, BroadcastStats } from "../../../../../src/lib/types.js"

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return

  const id = single(req.query.id)
  if (!id) return res.status(400).json({ error: "Missing id" })

  const [row] = await db.select().from(broadcasts).where(eq(broadcasts.id, id)).limit(1)
  if (!row) return res.status(404).json({ error: "Broadcast not found" })
  if (row.status === "sending") return res.status(409).json({ error: "Already sending." })
  if (row.status === "sent") return res.status(409).json({ error: "This broadcast was already sent." })

  await db.update(broadcasts).set({ status: "sending", updatedAt: new Date() }).where(eq(broadcasts.id, id))
  try {
    const result = await deliverBroadcast({
      id: row.id,
      title: row.title,
      body: row.body,
      imageUrl: row.imageUrl,
      link: row.link,
      linkType: row.linkType,
      importance: row.importance,
      audience: row.audience as BroadcastAudience,
    })
    const prev = (row.stats ?? {}) as BroadcastStats
    const [updated] = await db
      .update(broadcasts)
      .set({
        status: "sent",
        nextFireAt: null,
        sentAt: new Date(),
        stats: { delivered: (prev.delivered ?? 0) + result.delivered },
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, id))
      .returning()
    return res.json(serialize(updated))
  } catch (err) {
    // Roll back the status so the admin can retry.
    await db.update(broadcasts).set({ status: row.status, updatedAt: new Date() }).where(eq(broadcasts.id, id))
    console.error("[broadcasts/send] failed", err)
    return res.status(500).json({ error: "Send failed" })
  }
}
