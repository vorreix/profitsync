import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { adminRoles, appAdmins, userProfiles } from "../../src/lib/db/schema.js"
import { adminCaps, isAdminRole, sanitizeGrantableCaps, type AdminCapability, type AdminRole } from "../../src/lib/admin-roles.js"
import { getUserId } from "./auth.js"

/**
 * Root (bootstrap) admins are configured by email via the ROOT_ADMIN_EMAILS env
 * var (comma-separated; ROOT_ADMIN_EMAIL is also accepted). They are always
 * admins regardless of the app_admins table, so the very first admin can be set
 * without touching the database. Every other admin is a row in app_admins and is
 * managed from the admin console by a root admin.
 */
export function rootAdminEmails(): Set<string> {
  const raw = `${process.env.ROOT_ADMIN_EMAILS ?? ""},${process.env.ROOT_ADMIN_EMAIL ?? ""}`
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isRootAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return rootAdminEmails().has(email.toLowerCase())
}

/**
 * A resolved platform admin: the stored role key (system or custom), the
 * capability set it grants, and a `can` helper. Custom roles resolve through
 * the admin_roles table with their capabilities re-filtered to the grantable
 * set — the super-only capabilities can only ever come from `super_admin`.
 */
export type ResolvedAdmin = {
  role: string
  caps: AdminCapability[]
  can: (cap: AdminCapability) => boolean
}

// Custom role definitions change rarely; cache lookups briefly so admin pages
// (which fan out several /api/admin calls) don't repeat the query.
const customRoleCache = new Map<string, { caps: AdminCapability[] | null; at: number }>()
const CUSTOM_ROLE_TTL_MS = 30_000

async function customRoleCaps(key: string): Promise<AdminCapability[] | null> {
  const hit = customRoleCache.get(key)
  if (hit && Date.now() - hit.at < CUSTOM_ROLE_TTL_MS) return hit.caps
  const [row] = await db.select().from(adminRoles).where(eq(adminRoles.key, key))
  const caps = row ? sanitizeGrantableCaps(row.capabilities) : null
  customRoleCache.set(key, { caps, at: Date.now() })
  return caps
}

/** Invalidate the custom-role cache (call after role create/edit/delete). */
export function bustAdminRoleCache(): void {
  customRoleCache.clear()
}

function resolved(role: string, caps: AdminCapability[]): ResolvedAdmin {
  return { role, caps, can: (cap) => caps.includes(cap) }
}

/**
 * Resolve a signed-in user's platform-admin role + capabilities, or null if
 * they are not an admin. Root-email admins are always `super_admin`. System
 * roles use the static capability map; custom role keys resolve through
 * admin_roles. An UNKNOWN role key (e.g. a force-deleted custom role) resolves
 * to ZERO capabilities — never to super_admin.
 */
export async function getResolvedAdmin(userId: string): Promise<ResolvedAdmin | null> {
  const [row] = await db.select().from(appAdmins).where(eq(appAdmins.userId, userId))
  if (row) {
    // Legacy rows predating the role column default to super_admin.
    const key = row.role?.trim() || "super_admin"
    if (isAdminRole(key)) return resolved(key, adminCaps(key))
    const caps = await customRoleCaps(key)
    return resolved(key, caps ?? [])
  }

  // Bootstrap: the signed-in user's email matches a configured root admin.
  const roots = rootAdminEmails()
  if (roots.size === 0) return null

  // Prefer the profile email (cheap). Fall back to Clerk so a root admin is
  // recognized even on a first-ever visit, before their profile row exists.
  const [profile] = await db
    .select({ email: userProfiles.email })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
  let email = profile?.email
  if (!email && process.env.CLERK_SECRET_KEY) {
    try {
      const { createClerkClient } = await import("@clerk/backend")
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
      const user = await clerk.users.getUser(userId)
      email = user.emailAddresses[0]?.emailAddress
    } catch {
      // ignore — treat as not-admin
    }
  }
  if (!!email && roots.has(email.toLowerCase())) return resolved("super_admin", adminCaps("super_admin"))
  return null
}

/** Back-compat: the stored role key, or null. Prefer getResolvedAdmin. */
export async function getAdminRole(userId: string): Promise<AdminRole | null> {
  const r = await getResolvedAdmin(userId)
  if (!r) return null
  return isAdminRole(r.role) ? r.role : ("viewer" as AdminRole)
}

export async function isAdmin(userId: string): Promise<boolean> {
  return (await getResolvedAdmin(userId)) !== null
}

/**
 * Guard for routes that any admin (any role) may reach. Returns the userId or
 * writes a 401/403 and returns null.
 */
export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const userId = await getUserId(req)
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "Forbidden" })
    return null
  }
  return userId
}

/**
 * Capability-aware guard. Returns `{ userId, role, caps, can }` when the
 * signed-in admin's role grants `cap`, otherwise writes 401 (not signed in) /
 * 403 (not an admin, or lacks the capability) and returns null.
 *
 * Use the lowest capability a route needs at the top (usually "read"), then
 * check stronger capabilities (e.g. ctx.can("write")) inside individual
 * mutation branches — `can` understands custom roles; the static adminCan()
 * does not.
 */
export async function requireAdminCap(
  req: VercelRequest,
  res: VercelResponse,
  cap: AdminCapability,
): Promise<{ userId: string; role: string; caps: AdminCapability[]; can: (c: AdminCapability) => boolean } | null> {
  const userId = await getUserId(req)
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }
  const admin = await getResolvedAdmin(userId)
  if (!admin) {
    res.status(403).json({ error: "Forbidden" })
    return null
  }
  if (!admin.can(cap)) {
    res.status(403).json({ error: "You don't have permission for this action." })
    return null
  }
  return { userId, role: admin.role, caps: admin.caps, can: admin.can }
}
