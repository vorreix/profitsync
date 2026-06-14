// Saved user group members (#8) — list (joined with profiles for display) + PUT
// to replace the whole member set. Admin-only (`broadcast` capability).
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../../../src/lib/db/index.js"
import { userGroupMembers, userGroups, userProfiles } from "../../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../../_lib/admin.js"

const MAX_MEMBERS = 5000

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "broadcast")
  if (!ctx) return

  const id = single(req.query.id)
  if (!id) return res.status(400).json({ error: "Missing id" })

  const [group] = await db.select({ id: userGroups.id }).from(userGroups).where(eq(userGroups.id, id)).limit(1)
  if (!group) return res.status(404).json({ error: "Group not found" })

  if (req.method === "GET") {
    const rows = await db
      .select({
        user_id: userGroupMembers.userId,
        email: userProfiles.email,
        name: userProfiles.fullName,
      })
      .from(userGroupMembers)
      .leftJoin(userProfiles, eq(userProfiles.id, userGroupMembers.userId))
      .where(eq(userGroupMembers.groupId, id))
    return res.json({ members: rows.map((r) => ({ ...r, avatar_url: null })) })
  }

  if (req.method === "PUT") {
    const raw = (req.body as { userIds?: unknown })?.userIds
    const userIds = Array.isArray(raw)
      ? Array.from(new Set(raw.filter((u): u is string => typeof u === "string" && u.length > 0))).slice(0, MAX_MEMBERS)
      : []
    // Replace the whole set: clear then re-insert. (Neon HTTP has no multi-statement
    // transaction; an admin re-save is the recovery path if a write is interrupted.)
    await db.delete(userGroupMembers).where(eq(userGroupMembers.groupId, id))
    if (userIds.length > 0) {
      await db.insert(userGroupMembers).values(userIds.map((userId) => ({ groupId: id, userId })))
    }
    await db.update(userGroups).set({ updatedAt: new Date() }).where(eq(userGroups.id, id))
    return res.json({ ok: true, count: userIds.length })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
