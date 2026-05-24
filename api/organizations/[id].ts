import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { CURRENCY_LIST } from "../../src/lib/currencies"
import { db, serialize } from "../../src/lib/db"
import { organizations, organizationMembers, userProfiles } from "../../src/lib/db/schema"
import { getUserId } from "../_lib/auth"

const VALID_CURRENCIES = new Set(CURRENCY_LIST.map((c) => c.code))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const { id } = req.query as { id: string }

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
    if (member.role !== "owner" && member.role !== "admin") {
      return res.status(403).json({ error: "Only owners and admins can edit organization settings" })
    }
    const { name, currency } = req.body as { name?: string; currency?: string }

    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (name !== undefined) {
      if (org.isPersonal) {
        return res.status(400).json({ error: "Personal organization cannot be renamed" })
      }
      if (!name.trim()) return res.status(400).json({ error: "name cannot be empty" })
      updates.name = name.trim()
    }

    if (currency !== undefined) {
      const upper = currency.toUpperCase()
      if (!VALID_CURRENCIES.has(upper)) return res.status(400).json({ error: "Invalid currency code" })
      updates.currency = upper
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: "Nothing to update" })
    }

    const [updated] = await db
      .update(organizations)
      .set(updates)
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
