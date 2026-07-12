// Admin broadcasts (#7) — list + create. Admin-only (`broadcast` capability).
// A broadcast can be saved as a draft, scheduled (one-off or recurring), or sent
// immediately. Immediate sends fan out here via deliverBroadcast.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { broadcasts, userGroups } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { deliverBroadcast } from "../../_lib/broadcast-deliver.js"
import { linkError, sanitizeAudience, sanitizeSchedule, statusForMode } from "../../_lib/broadcast-validate.js"
import { enqueueNotificationTickAt } from "../../_lib/worker-jobs.js"
import type { BroadcastAudience } from "../../../src/lib/types.js"

const TITLE_MAX = 120
const BODY_MAX = 1000
const VALID_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"]

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

async function audienceError(audience: BroadcastAudience): Promise<string | null> {
  if (audience.type === "users" && audience.userIds.length === 0) return "Select at least one user."
  if (audience.type === "group") {
    if (!audience.groupId) return "Choose a group."
    const [g] = await db.select({ id: userGroups.id }).from(userGroups).where(eq(userGroups.id, audience.groupId)).limit(1)
    if (!g) return "That group no longer exists."
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return

  if (req.method === "GET") {
    const statusFilter = single(req.query.status)
    const where = statusFilter && VALID_STATUSES.includes(statusFilter) ? eq(broadcasts.status, statusFilter) : undefined
    const rows = await db.select().from(broadcasts).where(where).orderBy(desc(broadcasts.createdAt)).limit(200)
    return res.json({ broadcasts: rows.map((r) => serialize(r)) })
  }

  if (req.method === "POST") {
    const b = (req.body ?? {}) as Record<string, unknown>
    const mode = b.mode === "send" || b.mode === "schedule" ? b.mode : "draft"

    const title = typeof b.title === "string" ? b.title.trim().slice(0, TITLE_MAX) : ""
    if (!title) return res.status(400).json({ error: "A title is required." })
    const body = typeof b.body === "string" ? b.body.slice(0, BODY_MAX) : ""
    const linkType = b.link_type === "external" ? "external" : "internal"
    const link = typeof b.link === "string" && b.link.trim() ? b.link.trim() : null
    const linkErr = linkError(link, linkType)
    if (linkErr) return res.status(400).json({ error: linkErr })
    const imageUrl = typeof b.image_url === "string" && b.image_url.trim() ? b.image_url.trim() : null
    const importance = b.importance === true
    const audience = sanitizeAudience(b.audience)
    const schedule = sanitizeSchedule(b.schedule)

    const audErr = await audienceError(audience)
    if (audErr) return res.status(400).json({ error: audErr })

    // Persist first so we have an id for the per-recipient dedupe key.
    const base = {
      createdBy: ctx.userId,
      title,
      body,
      imageUrl,
      link,
      linkType,
      category: "system",
      importance,
      audience,
      schedule,
    }

    if (mode === "send") {
      const [row] = await db.insert(broadcasts).values({ ...base, status: "sending" }).returning()
      const result = await deliverBroadcast(
        { id: row.id, title, body, imageUrl, link, linkType, importance, audience },
        { occurrence: "manual" },
      )
      const [updated] = await db
        .update(broadcasts)
        .set({ status: "sent", sentAt: new Date(), stats: { delivered: result.delivered }, updatedAt: new Date() })
        .where(eq(broadcasts.id, row.id))
        .returning()
      return res.status(201).json(serialize(updated))
    }

    const { status, nextFireAt } = statusForMode(mode, schedule)
    const [row] = await db.insert(broadcasts).values({ ...base, status, nextFireAt }).returning()
    // Exact-time delivery: one one-shot worker job at the fire instant
    // (best-effort — the hourly sweep reconciles anything this misses).
    if (nextFireAt) {
      void enqueueNotificationTickAt(nextFireAt, `${row.id}:${nextFireAt.toISOString()}`).catch(() => {})
    }
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
