import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { asc, eq, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { appAdmins, userProfiles } from "../../../src/lib/db/schema.js"
import { isRootAdminEmail, requireAdminCap, rootAdminEmails } from "../../_lib/admin.js"
import { isAdminRole, type AdminRole } from "../../../src/lib/admin-roles.js"

type AdminRow = {
  user_id: string | null
  email: string | null
  full_name: string | null
  role: AdminRole
  is_root: boolean
  is_self: boolean
  created_at: Date | null
}

// Count app_admins rows that are super_admins (root-email admins are always
// super_admin but live outside the table). Used to prevent locking everyone out
// of the console by demoting/removing the last super_admin when no root admin
// is configured.
async function superAdminCount(): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appAdmins)
    .where(eq(appAdmins.role, "super_admin"))
  return n
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only admins who can manage admins may use this route at all.
  const ctx = await requireAdminCap(req, res, "manage_admins")
  if (!ctx) return
  const adminId = ctx.userId

  if (req.method === "GET") {
    const rows = await db
      .select({
        userId: appAdmins.userId,
        role: appAdmins.role,
        email: userProfiles.email,
        fullName: userProfiles.fullName,
        createdAt: appAdmins.createdAt,
      })
      .from(appAdmins)
      .leftJoin(userProfiles, eq(userProfiles.id, appAdmins.userId))
      .orderBy(asc(appAdmins.createdAt))

    const admins: AdminRow[] = rows.map((r) => ({
      user_id: r.userId,
      email: r.email,
      full_name: r.fullName,
      // Root-email admins are always super_admin regardless of the stored value.
      role: isRootAdminEmail(r.email) ? "super_admin" : (isAdminRole(r.role) ? r.role : "super_admin"),
      is_root: isRootAdminEmail(r.email),
      is_self: r.userId === adminId,
      created_at: r.createdAt,
    }))

    // Surface root admins that aren't yet in app_admins (env-configured only).
    const present = new Set(admins.map((a) => (a.email ?? "").toLowerCase()))
    for (const rootEmail of rootAdminEmails()) {
      if (present.has(rootEmail)) continue
      const [p] = await db
        .select({ id: userProfiles.id, email: userProfiles.email, fullName: userProfiles.fullName })
        .from(userProfiles)
        .where(sql`lower(${userProfiles.email}) = ${rootEmail}`)
      admins.push({
        user_id: p?.id ?? null,
        email: p?.email ?? rootEmail,
        full_name: p?.fullName ?? null,
        role: "super_admin",
        is_root: true,
        is_self: !!p?.id && p.id === adminId,
        created_at: null,
      })
    }

    return res.json({ admins, current_user_id: adminId })
  }

  if (req.method === "POST") {
    const { email, role } = req.body as { email?: string; role?: string }
    if (!email?.trim()) return res.status(400).json({ error: "email is required" })
    const newRole: AdminRole = isAdminRole(role) ? role : "viewer"
    const normalized = email.trim().toLowerCase()

    // Resolve the user id: prefer a profile (they've signed in), else ask Clerk.
    let userId: string | undefined
    let resolvedEmail = email.trim()
    let fullName: string | null = null
    const [profile] = await db
      .select({ id: userProfiles.id, email: userProfiles.email, fullName: userProfiles.fullName })
      .from(userProfiles)
      .where(sql`lower(${userProfiles.email}) = ${normalized}`)
    if (profile) {
      userId = profile.id
      resolvedEmail = profile.email
      fullName = profile.fullName
    } else if (process.env.CLERK_SECRET_KEY) {
      try {
        const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
        const users = await clerk.users.getUserList({ emailAddress: [email.trim()] })
        if (users.data.length) {
          userId = users.data[0].id
          fullName = users.data[0].fullName ?? null
        }
      } catch {
        // fall through to the not-found response
      }
    }

    if (!userId) {
      return res.status(404).json({ error: "No user found with that email. Ask them to sign up first." })
    }

    // Root-email admins are always super_admin — don't let a stored role shadow that.
    const effectiveRole: AdminRole = isRootAdminEmail(resolvedEmail) ? "super_admin" : newRole

    await db
      .insert(appAdmins)
      .values({ userId, role: effectiveRole })
      .onConflictDoUpdate({ target: appAdmins.userId, set: { role: effectiveRole } })

    return res.status(201).json({
      admin: {
        user_id: userId,
        email: resolvedEmail,
        full_name: fullName,
        role: effectiveRole,
        is_root: isRootAdminEmail(resolvedEmail),
        is_self: userId === adminId,
        created_at: new Date(),
      },
    })
  }

  if (req.method === "PATCH") {
    const { user_id, role } = req.body as { user_id?: string; role?: string }
    if (!user_id) return res.status(400).json({ error: "user_id is required" })
    if (!isAdminRole(role)) return res.status(400).json({ error: "Invalid role" })

    const [target] = await db
      .select({ email: userProfiles.email })
      .from(userProfiles)
      .where(eq(userProfiles.id, user_id))
    if (isRootAdminEmail(target?.email)) {
      return res.status(400).json({ error: "Root admins are always super admin and can't be changed here." })
    }

    const [existing] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))
    if (!existing) return res.status(404).json({ error: "Not an admin" })

    // Don't let the console lock itself out: block demoting the last super_admin
    // when there is no root admin to fall back on.
    if (existing.role === "super_admin" && role !== "super_admin" && rootAdminEmails().size === 0) {
      if ((await superAdminCount()) <= 1) {
        return res.status(400).json({ error: "Can't demote the last super admin." })
      }
    }

    const [updated] = await db
      .update(appAdmins)
      .set({ role })
      .where(eq(appAdmins.userId, user_id))
      .returning({ userId: appAdmins.userId, role: appAdmins.role })
    return res.json({ admin: updated })
  }

  if (req.method === "DELETE") {
    const { user_id } = req.body as { user_id?: string }
    if (!user_id) return res.status(400).json({ error: "user_id is required" })

    // Root admins are env-configured and can't be removed from here.
    const [target] = await db
      .select({ email: userProfiles.email })
      .from(userProfiles)
      .where(eq(userProfiles.id, user_id))
    if (isRootAdminEmail(target?.email)) {
      return res.status(400).json({
        error: "Root admins are configured via ROOT_ADMIN_EMAILS and can't be removed here.",
      })
    }

    const [existing] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))
    if (existing?.role === "super_admin" && rootAdminEmails().size === 0) {
      if ((await superAdminCount()) <= 1) {
        return res.status(400).json({ error: "Can't remove the last super admin." })
      }
    }

    const removed = await db.delete(appAdmins).where(eq(appAdmins.userId, user_id)).returning({ userId: appAdmins.userId })
    if (!removed.length) return res.status(404).json({ error: "Not an admin" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
