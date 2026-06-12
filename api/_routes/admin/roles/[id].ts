import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq, sql } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { adminRoles, appAdmins } from "../../../../src/lib/db/schema.js"
import { bustAdminRoleCache, requireAdminCap } from "../../../_lib/admin.js"
import { ROLE_NAME_MAX, sanitizeGrantableCaps } from "../../../../src/lib/admin-roles.js"

/**
 * PATCH/DELETE /api/admin/roles/:id — edit or delete a CUSTOM role.
 * Super-only (`manage_roles`); system roles never live in this table. The
 * role's `key` is immutable (admin rows reference it); name/description/
 * capabilities are editable. Deleting a role still assigned to any admin is
 * blocked with a 409.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "manage_roles")
  if (!ctx) return
  const { id } = req.query as { id: string }

  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, id))
  if (!role) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    const { name, description, capabilities } = req.body as {
      name?: string
      description?: string
      capabilities?: unknown
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) {
      const trimmed = name.trim().slice(0, ROLE_NAME_MAX)
      if (trimmed.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters" })
      updates.name = trimmed
    }
    if (description !== undefined) updates.description = description.trim().slice(0, 200)
    if (capabilities !== undefined) {
      const caps = sanitizeGrantableCaps(capabilities)
      if (caps.length === 0) return res.status(400).json({ error: "Pick at least one permission" })
      updates.capabilities = caps
    }

    const [updated] = await db.update(adminRoles).set(updates).where(eq(adminRoles.id, id)).returning()
    bustAdminRoleCache()
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(appAdmins)
      .where(eq(appAdmins.role, role.key))
    return res.json({ role: serialize({ ...updated, capabilities: sanitizeGrantableCaps(updated.capabilities), isSystem: false, inUse: n }) })
  }

  if (req.method === "DELETE") {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(appAdmins)
      .where(eq(appAdmins.role, role.key))
    if (n > 0) {
      return res.status(409).json({ error: `This role is assigned to ${n} admin${n === 1 ? "" : "s"}. Reassign them first.` })
    }
    await db.delete(adminRoles).where(eq(adminRoles.id, id))
    bustAdminRoleCache()
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
