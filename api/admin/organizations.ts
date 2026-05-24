import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { organizations, userProfiles } from "../../src/lib/db/schema"
import { requireAdmin } from "../_lib/admin"

const PAGE_SIZE = 30

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    const { search, page, type } = req.query as { search?: string; page?: string; type?: string }
    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const searchFilter = search?.trim()
      ? ilike(organizations.name, `%${search.trim()}%`)
      : undefined

    const typeFilter =
      type === "personal"
        ? eq(organizations.isPersonal, true)
        : type === "team"
          ? eq(organizations.isPersonal, false)
          : undefined

    const whereClause = and(searchFilter, typeFilter)

    const [{ total }] = await db
      .select({ total: count() })
      .from(organizations)
      .where(whereClause)

    const rows = await db
      .select({
        id: organizations.id,
        ownerUserId: organizations.ownerUserId,
        name: organizations.name,
        slug: organizations.slug,
        isPersonal: organizations.isPersonal,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        ownerEmail: userProfiles.email,
        ownerName: userProfiles.fullName,
        memberCount: sql<number>`(select count(*)::int from organization_members om where om.organization_id = organizations.id)`,
        clientCount: sql<number>`(select count(*)::int from clients c where c.organization_id = organizations.id and c.deleted_at is null)`,
        quotationCount: sql<number>`(select count(*)::int from quotations q where q.organization_id = organizations.id and q.deleted_at is null)`,
        planKey: sql<string>`(select s.plan_key from subscriptions s where s.organization_id = organizations.id order by s.updated_at desc limit 1)`,
        planStatus: sql<string>`(select s.status from subscriptions s where s.organization_id = organizations.id order by s.updated_at desc limit 1)`,
      })
      .from(organizations)
      .leftJoin(userProfiles, eq(userProfiles.id, organizations.ownerUserId))
      .where(whereClause)
      .orderBy(desc(organizations.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE })
  }

  if (req.method === "PATCH") {
    const { organization_id, name } = req.body as { organization_id?: string; name?: string }
    if (!organization_id || !name?.trim()) {
      return res.status(400).json({ error: "organization_id and name are required" })
    }
    const [updated] = await db
      .update(organizations)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(organizations.id, organization_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const { organization_id } = req.body as { organization_id?: string }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

    // Re-point any profile that had this as current to their personal org (or null)
    const profilesWithCurrent = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.currentOrganizationId, organization_id))

    for (const p of profilesWithCurrent) {
      const [personal] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.ownerUserId, p.id), eq(organizations.isPersonal, true)))
      await db
        .update(userProfiles)
        .set({ currentOrganizationId: personal?.id ?? null, updatedAt: new Date() })
        .where(eq(userProfiles.id, p.id))
    }

    const result = await db
      .delete(organizations)
      .where(eq(organizations.id, organization_id))
      .returning({ id: organizations.id })
    if (!result.length) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
