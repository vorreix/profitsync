// Admin broadcast (#7) — update (draft/scheduled only), cancel, delete.
// A sent broadcast is immutable history; only drafts/scheduled ones can change.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { broadcasts, userGroups } from "../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../_lib/admin.js"
import { linkError, sanitizeAudience, sanitizeSchedule, statusForMode } from "../../../_lib/broadcast-validate.js"

const TITLE_MAX = 120
const BODY_MAX = 1000

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return

  const id = single(req.query.id)
  if (!id) return res.status(400).json({ error: "Missing id" })

  const [row] = await db.select().from(broadcasts).where(eq(broadcasts.id, id)).limit(1)
  if (!row) return res.status(404).json({ error: "Broadcast not found" })

  if (req.method === "PATCH") {
    // "cancel" stops a scheduled broadcast from firing.
    if ((req.body as { action?: string })?.action === "cancel") {
      if (row.status !== "scheduled" && row.status !== "draft") {
        return res.status(409).json({ error: "Only draft or scheduled broadcasts can be cancelled." })
      }
      const [u] = await db
        .update(broadcasts)
        .set({ status: "cancelled", nextFireAt: null, updatedAt: new Date() })
        .where(eq(broadcasts.id, id))
        .returning()
      return res.json(serialize(u))
    }

    if (row.status !== "draft" && row.status !== "scheduled") {
      return res.status(409).json({ error: "Only draft or scheduled broadcasts can be edited." })
    }

    const b = (req.body ?? {}) as Record<string, unknown>
    const mode = b.mode === "schedule" ? "schedule" : "draft"
    const title = typeof b.title === "string" ? b.title.trim().slice(0, TITLE_MAX) : row.title
    if (!title) return res.status(400).json({ error: "A title is required." })
    const body = typeof b.body === "string" ? b.body.slice(0, BODY_MAX) : row.body
    const linkType = b.link_type === "external" ? "external" : "internal"
    const link = typeof b.link === "string" && b.link.trim() ? b.link.trim() : null
    const linkErr = linkError(link, linkType)
    if (linkErr) return res.status(400).json({ error: linkErr })
    const imageUrl = typeof b.image_url === "string" && b.image_url.trim() ? b.image_url.trim() : null
    const importance = b.importance === true
    const audience = sanitizeAudience(b.audience)
    const schedule = sanitizeSchedule(b.schedule)

    if (audience.type === "users" && audience.userIds.length === 0) {
      return res.status(400).json({ error: "Select at least one user." })
    }
    if (audience.type === "group") {
      if (!audience.groupId) return res.status(400).json({ error: "Choose a group." })
      const [g] = await db.select({ id: userGroups.id }).from(userGroups).where(eq(userGroups.id, audience.groupId)).limit(1)
      if (!g) return res.status(400).json({ error: "That group no longer exists." })
    }

    const { status, nextFireAt } = statusForMode(mode, schedule)
    const [u] = await db
      .update(broadcasts)
      .set({ title, body, imageUrl, link, linkType, importance, audience, schedule, status, nextFireAt, updatedAt: new Date() })
      .where(eq(broadcasts.id, id))
      .returning()
    return res.json(serialize(u))
  }

  if (req.method === "DELETE") {
    if (row.status === "sending") return res.status(409).json({ error: "This broadcast is sending — try again shortly." })
    await db.delete(broadcasts).where(eq(broadcasts.id, id))
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
