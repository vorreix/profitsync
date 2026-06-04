import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { appAdmins, userProfiles } from "../../src/lib/db/schema.js"
import { adminCan, isAdminRole, type AdminCapability, type AdminRole } from "../../src/lib/admin-roles.js"
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
 * Resolve a signed-in user's platform-admin role, or null if they are not an
 * admin. Root-email admins are always `super_admin`; everyone else's role comes
 * from their `app_admins` row (defaulting to super_admin for legacy rows).
 */
export async function getAdminRole(userId: string): Promise<AdminRole | null> {
  const [row] = await db.select().from(appAdmins).where(eq(appAdmins.userId, userId))
  if (row) return isAdminRole(row.role) ? row.role : "super_admin"

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
  return !!email && roots.has(email.toLowerCase()) ? "super_admin" : null
}

export async function isAdmin(userId: string): Promise<boolean> {
  return (await getAdminRole(userId)) !== null
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
 * Capability-aware guard. Returns `{ userId, role }` when the signed-in admin's
 * role grants `cap`, otherwise writes 401 (not signed in) / 403 (not an admin,
 * or lacks the capability) and returns null.
 *
 * Use the lowest capability a route needs at the top (usually "read"), then
 * check stronger capabilities (e.g. adminCan(role, "write")) inside individual
 * mutation branches.
 */
export async function requireAdminCap(
  req: VercelRequest,
  res: VercelResponse,
  cap: AdminCapability,
): Promise<{ userId: string; role: AdminRole } | null> {
  const userId = await getUserId(req)
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }
  const role = await getAdminRole(userId)
  if (!role) {
    res.status(403).json({ error: "Forbidden" })
    return null
  }
  if (!adminCan(role, cap)) {
    res.status(403).json({ error: "You don't have permission for this action." })
    return null
  }
  return { userId, role }
}
