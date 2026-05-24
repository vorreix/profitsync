import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, ilike } from "drizzle-orm"
import { db, serialize } from "../src/lib/db"
import { organizations, organizationMembers } from "../src/lib/db/schema"
import { getUserId } from "./_lib/auth"

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
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.userId, userId), searchFilter ?? undefined))
      .orderBy(asc(organizations.isPersonal), asc(organizations.name))

    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const { name } = req.body as { name?: string }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })

    const slug = await uniqueSlug(userId, slugify(name))
    const [created] = await db
      .insert(organizations)
      .values({
        ownerUserId: userId,
        name: name.trim(),
        slug,
        isPersonal: false,
      })
      .returning()
    await db.insert(organizationMembers).values({
      organizationId: created.id,
      userId,
      role: "owner",
    })
    return res.status(201).json(serialize({ ...created, role: "owner" }))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
