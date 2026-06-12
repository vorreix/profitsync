import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { adminRoles } from "../../../src/lib/db/schema.js"
import { bustAdminRoleCache, requireAdminCap } from "../../_lib/admin.js"
import {
  ADMIN_ROLE_META,
  ADMIN_ROLES,
  ADMIN_ROLE_CAPS,
  isAdminRole,
  roleKeyFromName,
  sanitizeGrantableCaps,
  ROLE_NAME_MAX,
  type AdminRole,
} from "../../../src/lib/admin-roles.js"

/**
 * GET  /api/admin/roles — the assignable role catalog (system + custom).
 *      VISIBILITY: the `super_admin` entry is OMITTED for callers without the
 *      super-only `manage_super_admins` capability — they must not even see
 *      that the role exists.
 * POST /api/admin/roles — create a custom role (super-only via `manage_roles`).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Listing is needed by anyone who can manage admins (the role pickers);
  // mutations are gated harder below.
  const ctx = await requireAdminCap(req, res, "manage_admins")
  if (!ctx) return

  if (req.method === "GET") {
    const systemRoles = ADMIN_ROLES.filter(
      (r): r is AdminRole => r !== "super_admin" || ctx.can("manage_super_admins"),
    ).map((r) => ({
      id: null,
      key: r,
      name: ADMIN_ROLE_META[r].label,
      description: ADMIN_ROLE_META[r].description,
      capabilities: ADMIN_ROLE_CAPS[r],
      is_system: true,
      in_use: 0,
    }))

    const custom = await db
      .select({
        id: adminRoles.id,
        key: adminRoles.key,
        name: adminRoles.name,
        description: adminRoles.description,
        capabilities: adminRoles.capabilities,
        inUse: sql<number>`(select count(*)::int from app_admins aa where aa.role = ${adminRoles.key})`,
      })
      .from(adminRoles)
      .orderBy(asc(adminRoles.createdAt))

    return res.json({
      roles: [
        ...systemRoles,
        ...custom.map((r) => serialize({ ...r, capabilities: sanitizeGrantableCaps(r.capabilities), isSystem: false })),
      ],
      can_manage_roles: ctx.can("manage_roles"),
    })
  }

  if (req.method === "POST") {
    if (!ctx.can("manage_roles")) {
      return res.status(403).json({ error: "Only a super admin can create roles." })
    }
    const { name, description, capabilities } = req.body as {
      name?: string
      description?: string
      capabilities?: unknown
    }
    const trimmed = (name ?? "").trim().slice(0, ROLE_NAME_MAX)
    if (trimmed.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters" })
    const key = roleKeyFromName(trimmed)
    if (!key) return res.status(400).json({ error: "Name must contain letters or numbers" })
    if (isAdminRole(key)) return res.status(400).json({ error: "That name is reserved for a built-in role" })
    const caps = sanitizeGrantableCaps(capabilities)
    if (caps.length === 0) return res.status(400).json({ error: "Pick at least one permission" })

    const [existing] = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.key, key))
    if (existing) return res.status(409).json({ error: "A role with that name already exists" })

    const [row] = await db
      .insert(adminRoles)
      .values({ key, name: trimmed, description: (description ?? "").trim().slice(0, 200), capabilities: caps, createdBy: ctx.userId })
      .returning()
    bustAdminRoleCache()
    return res.status(201).json({ role: serialize({ ...row, isSystem: false, inUse: 0 }) })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
