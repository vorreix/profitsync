import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { organizations, subscriptions, userProfiles } from "../../../src/lib/db/schema.js"
import { createOrgForUser } from "../../_lib/auth.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { cancelledNowFields, FREE_RESET_FIELDS, stopDodoBilling } from "../../_lib/admin-billing.js"
import { teardownOrganization } from "../../_lib/admin-org-delete.js"

const PAGE_SIZE = 30

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return base || "org"
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let candidate = base
  let n = 0
  for (;;) {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
    if (!existing) return candidate
    n += 1
    candidate = `${base}-${n}`
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, req.method === "GET" ? "read" : "write")
  if (!ctx) return

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
        accountType: organizations.accountType,
        currency: organizations.currency,
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

  if (req.method === "POST") {
    const { owner_user_id, name, currency } = req.body as {
      owner_user_id?: string
      name?: string
      currency?: string
    }
    if (!owner_user_id?.trim() || !name?.trim()) {
      return res.status(400).json({ error: "owner_user_id and name are required" })
    }

    const [owner] = await db
      .select({ id: userProfiles.id, currency: userProfiles.currency })
      .from(userProfiles)
      .where(eq(userProfiles.id, owner_user_id))
    if (!owner) return res.status(404).json({ error: "Owner profile not found" })

    const slug = await ensureUniqueSlug(slugify(name))
    const created = await createOrgForUser({
      userId: owner_user_id,
      name: name.trim(),
      slug,
      isPersonal: false,
      currency: currency ?? owner.currency ?? "USD",
    })

    const [row] = await db.select().from(organizations).where(eq(organizations.id, created.id))
    return res.status(201).json(serialize(row))
  }

  if (req.method === "PATCH") {
    const { organization_id, name, plan_key, plan_status, currency } = req.body as {
      organization_id?: string
      name?: string
      plan_key?: "free" | "personal" | "business" | "premium"
      plan_status?: "active" | "past_due" | "cancelled" | "trialing"
      currency?: string
    }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

    const patch: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() }
    if (typeof name === "string" && name.trim()) patch.name = name.trim()
    if (typeof currency === "string" && currency.trim()) patch.currency = currency.trim().toUpperCase()

    let orgRow:
      | { id: string; name: string; slug: string; isPersonal: boolean; ownerUserId: string; currency: string; createdAt: Date | null; updatedAt: Date | null }
      | undefined

    if (patch.name || patch.currency) {
      const [updated] = await db
        .update(organizations)
        .set(patch)
        .where(eq(organizations.id, organization_id))
        .returning()
      if (!updated) return res.status(404).json({ error: "Not found" })
      orgRow = updated
    } else {
      const [existing] = await db.select().from(organizations).where(eq(organizations.id, organization_id))
      if (!existing) return res.status(404).json({ error: "Not found" })
      orgRow = existing
    }

    if (plan_key || plan_status) {
      // Downgrading to free, or cancelling, must also stop billing on Dodo and
      // wipe the stale period/cancel/provider fields — otherwise the row keeps a
      // "Renews on …" date and Dodo keeps the subscription active and charging.
      const goingFree = plan_key === "free"
      const goingCancelled = plan_status === "cancelled" && !goingFree

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organization_id))

      if (sub) {
        if (goingFree || goingCancelled) {
          const stop = await stopDodoBilling(sub)
          if (stop.provider === "dodo" && !stop.ok) {
            // Fail loud and leave the DB untouched so the admin can retry instead
            // of silently desyncing our mirror from Dodo.
            return res.status(502).json({ error: `Dodo cancel failed: ${stop.error}` })
          }
        }

        const subPatch = goingFree
          ? { ...FREE_RESET_FIELDS, updatedAt: new Date() }
          : goingCancelled
            ? { ...(plan_key ? { planKey: plan_key } : {}), ...cancelledNowFields(new Date()), updatedAt: new Date() }
            : {
                ...(plan_key ? { planKey: plan_key } : {}),
                ...(plan_status ? { status: plan_status } : {}),
                updatedAt: new Date(),
              }

        await db.update(subscriptions).set(subPatch).where(eq(subscriptions.id, sub.id))
      } else {
        // No subscription row yet → nothing to cancel on Dodo; just create the mirror.
        await db.insert(subscriptions).values({
          organizationId: organization_id,
          planKey: plan_key ?? "free",
          status: plan_status ?? "active",
        })
      }
    }

    return res.json(serialize(orgRow))
  }

  if (req.method === "DELETE") {
    const { organization_id } = req.body as { organization_id?: string }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

    // Full teardown: cancel Dodo billing + clean clients/quotations (no org FK) +
    // cascade the rest. Shared with the bulk-delete route so both behave identically.
    const result = await teardownOrganization(organization_id)
    if (!result.deleted) return res.status(404).json({ error: "Not found" })
    return res.json({
      ok: true,
      dodo_cancelled: result.dodo.provider === "dodo" && result.dodo.ok,
      dodo_error: result.dodo.provider === "dodo" && !result.dodo.ok ? result.dodo.error : null,
    })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
