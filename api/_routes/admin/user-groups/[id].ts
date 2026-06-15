// Saved user group (#8) — rename + delete. Delete is blocked while a draft or
// scheduled broadcast still targets the group (sent broadcasts are historical and
// already fanned out, so they don't block).
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { broadcasts, userGroups } from "../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../_lib/admin.js"

const NAME_MAX = 60

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return

  const id = single(req.query.id)
  if (!id) return res.status(400).json({ error: "Missing id" })

  const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id)).limit(1)
  if (!group) return res.status(404).json({ error: "Group not found" })

  if (req.method === "PATCH") {
    const name = typeof (req.body as { name?: unknown })?.name === "string" ? (req.body as { name: string }).name.trim().slice(0, NAME_MAX) : ""
    if (!name) return res.status(400).json({ error: "A group name is required." })
    try {
      const [row] = await db
        .update(userGroups)
        .set({ name, updatedAt: new Date() })
        .where(eq(userGroups.id, id))
        .returning()
      return res.json(serialize(row))
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ error: "You already have a group with that name." })
      }
      throw err
    }
  }

  if (req.method === "DELETE") {
    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(broadcasts)
      .where(
        and(
          inArray(broadcasts.status, ["draft", "scheduled"]),
          sql`${broadcasts.audience}->>'type' = 'group'`,
          sql`${broadcasts.audience}->>'groupId' = ${id}`,
        ),
      )
    if ((pending?.count ?? 0) > 0) {
      return res.status(409).json({ error: "This group is used by a draft or scheduled broadcast. Remove it there first." })
    }
    await db.delete(userGroups).where(eq(userGroups.id, id)) // members cascade
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
