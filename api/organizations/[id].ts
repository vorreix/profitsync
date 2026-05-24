import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { organizations, organizationMembers, userProfiles } from "../../src/lib/db/schema"
import { getUserId } from "../_lib/auth"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const { id } = req.query as { id: string }

  // Verify membership
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, id), eq(organizationMembers.userId, userId)))
  if (!member) return res.status(404).json({ error: "Not found" })

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!org) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    return res.json(serialize({ ...org, role: member.role }))
  }

  if (req.method === "PATCH") {
    if (org.isPersonal) {
      return res.status(400).json({ error: "Personal organization cannot be renamed" })
    }
    if (member.role !== "owner" && member.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" })
    }
    const { name } = req.body as { name?: string }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    const [updated] = await db
      .update(organizations)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning()
    return res.json(serialize({ ...updated, role: member.role }))
  }

  if (req.method === "DELETE") {
    if (org.isPersonal) {
      return res.status(400).json({ error: "Personal organization cannot be deleted" })
    }
    if (member.role !== "owner") {
      return res.status(403).json({ error: "Forbidden" })
    }

    // If user's current org points here, fall back to their personal org
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
    if (profile?.currentOrganizationId === id) {
      const [personal] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.ownerUserId, userId), eq(organizations.isPersonal, true)))
      await db
        .update(userProfiles)
        .set({ currentOrganizationId: personal?.id ?? null, updatedAt: new Date() })
        .where(eq(userProfiles.id, userId))
    }

    await db.delete(organizations).where(eq(organizations.id, id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
