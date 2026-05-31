import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { appAdmins, userProfiles } from "../../src/lib/db/schema.js"
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

export async function isAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select().from(appAdmins).where(eq(appAdmins.userId, userId))
  if (row) return true

  // Bootstrap: the signed-in user's email matches a configured root admin.
  const roots = rootAdminEmails()
  if (roots.size === 0) return false

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
  return !!email && roots.has(email.toLowerCase())
}

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
