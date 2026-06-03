import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  appAdmins,
  organizationMembers,
  organizations,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

const PAGE_SIZE = 30

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, req.method === "GET" ? "read" : "write")
  if (!ctx) return
  const adminId = ctx.userId

  if (req.method === "GET") {
    const { search, page, banned } = req.query as { search?: string; page?: string; banned?: string }
    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const searchFilter = search?.trim()
      ? or(
          ilike(userProfiles.email, `%${search.trim()}%`),
          ilike(userProfiles.fullName, `%${search.trim()}%`),
          ilike(userProfiles.id, `%${search.trim()}%`),
        )
      : undefined

    const bannedFilter =
      banned === "true"
        ? sql`${userProfiles.bannedAt} IS NOT NULL`
        : banned === "false"
          ? sql`${userProfiles.bannedAt} IS NULL`
          : undefined

    const whereClause = and(searchFilter, bannedFilter)

    const [{ total }] = await db
      .select({ total: count() })
      .from(userProfiles)
      .where(whereClause)

    const rows = await db
      .select({
        id: userProfiles.id,
        email: userProfiles.email,
        fullName: userProfiles.fullName,
        currency: userProfiles.currency,
        currentOrganizationId: userProfiles.currentOrganizationId,
        termsAcceptedAt: userProfiles.termsAcceptedAt,
        bannedAt: userProfiles.bannedAt,
        createdAt: userProfiles.createdAt,
        updatedAt: userProfiles.updatedAt,
        isAdmin: sql<boolean>`exists (select 1 from app_admins aa where aa.user_id = user_profiles.id)`,
        orgCount: sql<number>`(select count(*)::int from organization_members om where om.user_id = user_profiles.id)`,
        premiumOrgCount: sql<number>`(
          select count(*)::int
          from subscriptions s
          inner join organization_members om on om.organization_id = s.organization_id
          where om.user_id = user_profiles.id
            and s.plan_key <> 'free'
            and s.status = 'active'
        )`,
      })
      .from(userProfiles)
      .where(whereClause)
      .orderBy(desc(userProfiles.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE })
  }

  if (req.method === "PATCH") {
    const { user_id, action, role } = req.body as {
      user_id?: string
      action?: "ban" | "unban" | "promote" | "demote"
      role?: string
    }
    if (!user_id || !action) return res.status(400).json({ error: "user_id and action are required" })

    if (action === "ban") {
      const [updated] = await db
        .update(userProfiles)
        .set({ bannedAt: new Date(), updatedAt: new Date() })
        .where(eq(userProfiles.id, user_id))
        .returning()
      if (!updated) return res.status(404).json({ error: "Not found" })
      return res.json(serialize(updated))
    }
    if (action === "unban") {
      const [updated] = await db
        .update(userProfiles)
        .set({ bannedAt: null, updatedAt: new Date() })
        .where(eq(userProfiles.id, user_id))
        .returning()
      if (!updated) return res.status(404).json({ error: "Not found" })
      return res.json(serialize(updated))
    }
    if (action === "promote") {
      const [existing] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))
      if (existing) return res.json({ ok: true, already: true })
      await db.insert(appAdmins).values({ userId: user_id })
      return res.json({ ok: true })
    }
    if (action === "demote") {
      if (user_id === adminId) {
        return res.status(400).json({ error: "Cannot demote yourself" })
      }
      await db.delete(appAdmins).where(eq(appAdmins.userId, user_id))
      return res.json({ ok: true })
    }
    // role parameter currently unused — reserved for future global role assignments
    void role
    return res.status(400).json({ error: "Unknown action" })
  }

  if (req.method === "DELETE") {
    const { user_id } = req.body as { user_id?: string }
    if (!user_id) return res.status(400).json({ error: "user_id is required" })
    if (user_id === adminId) {
      return res.status(400).json({ error: "Cannot delete yourself" })
    }

    // Delete every org the user owns (cascades to clients/transactions/subscriptions/invoices/members/invitations).
    const ownedOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerUserId, user_id))

    for (const o of ownedOrgs) {
      // Re-point any profile that had this org as current
      const profilesWithCurrent = await db
        .select({ id: userProfiles.id })
        .from(userProfiles)
        .where(eq(userProfiles.currentOrganizationId, o.id))
      for (const p of profilesWithCurrent) {
        await db
          .update(userProfiles)
          .set({ currentOrganizationId: null, updatedAt: new Date() })
          .where(eq(userProfiles.id, p.id))
      }
      await db.delete(organizations).where(eq(organizations.id, o.id))
    }

    // Drop any non-owner memberships the user holds in other orgs.
    await db.delete(organizationMembers).where(eq(organizationMembers.userId, user_id))

    // Drop app-admin grant if any.
    await db.delete(appAdmins).where(eq(appAdmins.userId, user_id))

    // Finally delete the profile row.
    const result = await db
      .delete(userProfiles)
      .where(eq(userProfiles.id, user_id))
      .returning({ id: userProfiles.id })
    if (!result.length) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
