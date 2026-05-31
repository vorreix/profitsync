import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { asc, eq, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { appAdmins, userProfiles } from "../../../src/lib/db/schema.js"
import { isRootAdminEmail, requireAdmin, rootAdminEmails } from "../../_lib/admin.js"

type AdminRow = {
  user_id: string | null
  email: string | null
  full_name: string | null
  is_root: boolean
  is_self: boolean
  created_at: Date | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    const rows = await db
      .select({
        userId: appAdmins.userId,
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
        is_root: true,
        is_self: !!p?.id && p.id === adminId,
        created_at: null,
      })
    }

    return res.json({ admins, current_user_id: adminId })
  }

  if (req.method === "POST") {
    const { email } = req.body as { email?: string }
    if (!email?.trim()) return res.status(400).json({ error: "email is required" })
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

    await db.insert(appAdmins).values({ userId }).onConflictDoNothing()
    return res.status(201).json({
      admin: {
        user_id: userId,
        email: resolvedEmail,
        full_name: fullName,
        is_root: isRootAdminEmail(resolvedEmail),
        is_self: userId === adminId,
        created_at: new Date(),
      },
    })
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

    const removed = await db.delete(appAdmins).where(eq(appAdmins.userId, user_id)).returning({ userId: appAdmins.userId })
    if (!removed.length) return res.status(404).json({ error: "Not an admin" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
