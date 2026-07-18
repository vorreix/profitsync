import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, exists, gte, ilike, inArray, lte, ne, not, or, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  appAdmins,
  organizationMembers,
  subscriptions,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { requireAdminCap, rootAdminEmails } from "../../_lib/admin.js"
import { deleteUserAccount } from "../../_lib/account-delete.js"

const PAGE_SIZE = 30
const IDS_CAP = 10000

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

// Parse a comma-separated query param into a de-duped, trimmed, capped list. The
// values flow into parameterized inArray() — never string-concatenated into SQL.
function listParam(v: string | string[] | undefined, cap: number): string[] {
  const raw = Array.isArray(v) ? v.join(",") : v ?? ""
  return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))).slice(0, cap)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, req.method === "GET" ? "read" : "write")
  if (!ctx) return
  const adminId = ctx.userId

  if (req.method === "GET") {
    // meta mode: distinct countries + languages to populate the audience filters.
    if (single(req.query.meta) === "1") {
      const [countryRows, langRows] = await Promise.all([
        db.selectDistinct({ v: userProfiles.country }).from(userProfiles),
        db.selectDistinct({ v: userProfiles.language }).from(userProfiles),
      ])
      const clean = (rows: { v: string | null }[]) =>
        Array.from(new Set(rows.map((r) => (r.v ?? "").trim()).filter(Boolean))).sort()
      return res.json({ countries: clean(countryRows), languages: clean(langRows) })
    }

    const search = single(req.query.search)?.trim()
    const banned = single(req.query.banned)
    const plan = single(req.query.plan)
    const admin = single(req.query.admin)
    const joinedFrom = single(req.query.joinedFrom)
    const joinedTo = single(req.query.joinedTo)
    const orgIds = listParam(req.query.orgIds, 200)
    const countries = listParam(req.query.countries, 300)
    const languages = listParam(req.query.languages, 50)

    const searchFilter = search
      ? or(
          ilike(userProfiles.email, `%${search}%`),
          ilike(userProfiles.fullName, `%${search}%`),
          ilike(userProfiles.id, `%${search}%`),
        )
      : undefined

    const bannedFilter =
      banned === "true"
        ? sql`${userProfiles.bannedAt} IS NOT NULL`
        : banned === "false"
          ? sql`${userProfiles.bannedAt} IS NULL`
          : undefined

    // Member of ANY selected org.
    const orgFilter = orgIds.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(organizationMembers)
            .where(and(eq(organizationMembers.userId, userProfiles.id), inArray(organizationMembers.organizationId, orgIds))),
        )
      : undefined

    // Premium = belongs to an org with a live paid subscription.
    const premiumExists = exists(
      db
        .select({ one: sql`1` })
        .from(subscriptions)
        .innerJoin(organizationMembers, eq(organizationMembers.organizationId, subscriptions.organizationId))
        .where(
          and(
            eq(organizationMembers.userId, userProfiles.id),
            ne(subscriptions.planKey, "free"),
            inArray(subscriptions.status, ["active", "past_due", "trialing"]),
          ),
        ),
    )
    const planFilter = plan === "premium" ? premiumExists : plan === "free" ? not(premiumExists) : undefined

    const adminFilter =
      admin === "true"
        ? exists(db.select({ one: sql`1` }).from(appAdmins).where(eq(appAdmins.userId, userProfiles.id)))
        : undefined

    const joinedFromFilter = joinedFrom ? gte(userProfiles.createdAt, new Date(`${joinedFrom}T00:00:00.000Z`)) : undefined
    const joinedToFilter = joinedTo ? lte(userProfiles.createdAt, new Date(`${joinedTo}T23:59:59.999Z`)) : undefined
    const countryFilter = countries.length ? inArray(userProfiles.country, countries) : undefined
    const langFilter = languages.length ? inArray(userProfiles.language, languages) : undefined

    const whereClause = and(
      searchFilter,
      bannedFilter,
      orgFilter,
      planFilter,
      adminFilter,
      joinedFromFilter,
      joinedToFilter,
      countryFilter,
      langFilter,
    )

    // ids mode: ALL matching user ids (capped) — powers "select all matching".
    if (single(req.query.format) === "ids") {
      const idRows = await db
        .select({ id: userProfiles.id })
        .from(userProfiles)
        .where(whereClause)
        .orderBy(desc(userProfiles.createdAt))
        .limit(IDS_CAP)
      return res.json({ ids: idRows.map((r) => r.id), total: idRows.length, capped: idRows.length >= IDS_CAP })
    }

    const pageNum = Math.max(1, parseInt(single(req.query.page) ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const [{ total }] = await db.select({ total: count() }).from(userProfiles).where(whereClause)

    const rows = await db
      .select({
        id: userProfiles.id,
        email: userProfiles.email,
        fullName: userProfiles.fullName,
        currency: userProfiles.currency,
        language: userProfiles.language,
        country: userProfiles.country,
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
      // Granting platform-admin access is admin management, not a content write —
      // only admins who can manage admins may do it.
      if (!ctx.can("manage_admins")) {
        return res.status(403).json({ error: "You don't have permission to manage admins." })
      }
      const [existing] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))
      if (existing) return res.json({ ok: true, already: true })
      // Grant the least-privileged admin role by default; elevate from /admin/admins.
      await db.insert(appAdmins).values({ userId: user_id, role: "viewer" })
      return res.json({ ok: true })
    }
    if (action === "demote") {
      if (!ctx.can("manage_admins")) {
        return res.status(403).json({ error: "You don't have permission to manage admins." })
      }
      if (user_id === adminId) {
        return res.status(400).json({ error: "Cannot demote yourself" })
      }
      // Removing a SUPER admin (or the last one) is reserved for super admins.
      const [targetAdmin] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))
      if (targetAdmin?.role === "super_admin") {
        if (!ctx.can("manage_super_admins")) {
          return res.status(403).json({ error: "Only a super admin can demote a super admin." })
        }
        const supers = await db.select({ id: appAdmins.userId }).from(appAdmins).where(eq(appAdmins.role, "super_admin"))
        if (supers.length <= 1 && rootAdminEmails().size === 0) {
          return res.status(400).json({ error: "Cannot demote the last super admin." })
        }
      }
      await db.delete(appAdmins).where(eq(appAdmins.userId, user_id))
      return res.json({ ok: true })
    }
    // role parameter currently unused — reserved for future global role assignments
    void role
    return res.status(400).json({ error: "Unknown action" })
  }

  if (req.method === "DELETE") {
    // Deleting a user account cascades all their data and drops any admin grant —
    // an admin-management-grade action, not a routine content write.
    if (!ctx.can("manage_admins")) {
      return res.status(403).json({ error: "You don't have permission to delete user accounts." })
    }
    const { user_id } = req.body as { user_id?: string }
    if (!user_id) return res.status(400).json({ error: "user_id is required" })
    if (user_id === adminId) {
      return res.status(400).json({ error: "Cannot delete yourself" })
    }
    // Deleting a SUPER admin's account is reserved for super admins.
    const [targetAdminRow] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))
    if (targetAdminRow?.role === "super_admin" && !ctx.can("manage_super_admins")) {
      return res.status(403).json({ error: "Only a super admin can delete a super admin's account." })
    }

    const [existingProfile] = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.id, user_id))
    if (!existingProfile) return res.status(404).json({ error: "Not found" })

    // Shared with the self-serve delete-account flow. Fixes two old bugs: owned
    // orgs are now torn down via teardownOrganization (Dodo billing cancelled
    // FIRST — the old direct org delete kept charging the customer), and
    // user-scoped rows (push subscriptions, referral codes, …) are cleaned up.
    // Also deletes the Clerk user so they can't log back in and resurrect an
    // empty account.
    const result = await deleteUserAccount(user_id)
    return res.json({ ok: true, clerk_deleted: result.clerkDeleted })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
