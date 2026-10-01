import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, ne, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { tags } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { normalizeTagName } from "../../../src/lib/tags.js"
import { removeTagEverywhere, renameTagEverywhere, softDeleteByTag } from "../../_lib/tag-ops.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
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

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Delete-with-choice: `mode=tag_only` (default) just strips the tag from every
    // entity (records survive); `mode=with_records` soft-deletes the tagged records
    // to Trash with wealth-balance reversal (transfers through the transfer
    // service; any it would refuse are kept and listed in `skipped_transactions`;
    // any other failure throws before the tag is touched, so a retry is whole).
    // The registry row is removed either way.
    const mode = (req.query as { mode?: string }).mode === "with_records" ? "with_records" : "tag_only"
    let counts = { transactions: 0, clients: 0, quotations: 0 }
    let skipped: string[] = []
    if (mode === "with_records") {
      const { skipped_transactions, ...deleted } = await softDeleteByTag(orgId, tag.name, userId)
      counts = deleted
      skipped = skipped_transactions
      // Strip the now-orphaned tag from the records that stayed live (e.g. a
      // kept transfer). Rows just moved to Trash keep it, so a restore is whole.
      await removeTagEverywhere(orgId, tag.name, true)
    } else {
      await removeTagEverywhere(orgId, tag.name)
    }
    await db.delete(tags).where(and(eq(tags.id, id), eq(tags.organizationId, orgId)))
    return res.json({ ok: true, mode, deleted: counts, skipped_transactions: skipped })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
