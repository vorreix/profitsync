import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, ilike, sql } from "drizzle-orm"
import { CURRENCY_LIST } from "../../src/lib/currencies.js"
import { db, serialize } from "../../src/lib/db/index.js"
import { organizations, organizationMembers, userProfiles } from "../../src/lib/db/schema.js"
import { createOrgForUser, getUserId } from "../_lib/auth.js"

const VALID_CURRENCIES = new Set(CURRENCY_LIST.map((c) => c.code))

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "org"
}

async function uniqueSlug(userId: string, base: string): Promise<string> {
  let candidate = base
  let suffix = 1
  while (true) {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.ownerUserId, userId), eq(organizations.slug, candidate)))
    if (!existing) return candidate
    suffix += 1
    candidate = `${base}-${suffix}`
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "GET") {
    const { search } = req.query as { search?: string }

    const searchFilter = search?.trim() ? ilike(organizations.name, `%${search.trim()}%`) : undefined

    const rows = await db
      .select({
        id: organizations.id,
        ownerUserId: organizations.ownerUserId,
        name: organizations.name,
        slug: organizations.slug,
        isPersonal: organizations.isPersonal,
        currency: organizations.currency,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        role: organizationMembers.role,
        planKey: sql<string>`coalesce((select s.plan_key from subscriptions s where s.organization_id = organizations.id and s.status in ('active', 'trialing') order by s.updated_at desc limit 1), 'free')`,
        planStatus: sql<string>`coalesce((select s.status from subscriptions s where s.organization_id = organizations.id order by s.updated_at desc limit 1), 'active')`,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.userId, userId), searchFilter ?? undefined))
      .orderBy(asc(organizations.isPersonal), asc(organizations.name))

    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const { name, currency } = req.body as { name?: string; currency?: string }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    if (currency !== undefined && !VALID_CURRENCIES.has(currency.toUpperCase())) {
      return res.status(400).json({ error: "Invalid currency code" })
    }

    let resolvedCurrency = currency?.toUpperCase()
    if (!resolvedCurrency) {
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
      resolvedCurrency = profile?.currency ?? "USD"
    }

    const slug = await uniqueSlug(userId, slugify(name))
    await createOrgForUser({
      userId,
      name: name.trim(),
      slug,
      isPersonal: false,
      currency: resolvedCurrency,
    })

    // Return full record with plan info (mirrors GET shape)
    const [created] = await db
      .select({
        id: organizations.id,
        ownerUserId: organizations.ownerUserId,
        name: organizations.name,
        slug: organizations.slug,
        isPersonal: organizations.isPersonal,
        currency: organizations.currency,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        role: sql<string>`'owner'`,
        planKey: sql<string>`'free'`,
        planStatus: sql<string>`'active'`,
      })
      .from(organizations)
      .where(and(eq(organizations.ownerUserId, userId), eq(organizations.slug, slug)))

    return res.status(201).json(serialize(created))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
