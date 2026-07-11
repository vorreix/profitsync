import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, ne, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { tags } from "../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { normalizeTagName } from "../../../src/lib/tags.js"
import { renameTagEverywhere } from "../../_lib/tag-ops.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx
  const { id } = req.query as { id: string }

  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.organizationId, orgId)))
  if (!tag) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, color } = req.body as { name?: unknown; color?: unknown }

    let nextName = tag.name
    if (name !== undefined) {
      const cleaned = normalizeTagName(String(name ?? ""))
      if (!cleaned) return res.status(400).json({ error: "name is required" })
      if (cleaned.toLowerCase() !== tag.name.toLowerCase()) {
        // Reject a collision with a DIFFERENT existing tag (case-insensitive).
        const [clash] = await db
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.organizationId, orgId), ne(tags.id, id), sql`lower(${tags.name}) = ${cleaned.toLowerCase()}`))
        if (clash) return res.status(409).json({ error: "A tag with that name already exists" })
        // Cascade the rename into every entity's tags array first, then the row.
        await renameTagEverywhere(orgId, tag.name, cleaned)
      }
      nextName = cleaned
    }

    const nextColor = color !== undefined && typeof color === "string" ? color.trim().slice(0, 32) : tag.color
    const [updated] = await db
      .update(tags)
      .set({ name: nextName, color: nextColor, updatedAt: new Date() })
      .where(and(eq(tags.id, id), eq(tags.organizationId, orgId)))
      .returning()
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
