// Saved user groups (#8) — reusable broadcast audiences. Admin-only (the
// `broadcast` capability). Groups are a shared admin resource: any broadcast-capable
// admin can list + target any group; `created_by` records provenance.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { userGroups } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

const NAME_MAX = 60

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return

  if (req.method === "GET") {
    const rows = await db
      .select({
        id: userGroups.id,
        name: userGroups.name,
        createdBy: userGroups.createdBy,
        createdAt: userGroups.createdAt,
        updatedAt: userGroups.updatedAt,
        memberCount: sql<number>`(select count(*)::int from user_group_members m where m.group_id = ${userGroups.id})`,
      })
      .from(userGroups)
      .orderBy(desc(userGroups.createdAt))
    return res.json({ groups: rows.map((r) => serialize(r)) })
  }

  if (req.method === "POST") {
    const name = typeof (req.body as { name?: unknown })?.name === "string" ? (req.body as { name: string }).name.trim().slice(0, NAME_MAX) : ""
    if (!name) return res.status(400).json({ error: "A group name is required." })
    try {
      const [row] = await db.insert(userGroups).values({ name, createdBy: ctx.userId }).returning()
      return res.status(201).json(serialize({ ...row, memberCount: 0 }))
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ error: "You already have a group with that name." })
      }
      throw err
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}
