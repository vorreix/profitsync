import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { categories, clients, transactions } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"

const MAX_NAME_LENGTH = 60
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g")
function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NAME_LENGTH) : ""
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx
  const { id } = req.query as { id: string }

  // Resolve + org-scope up front.
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.organizationId, orgId)))
  if (!category) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, color } = req.body as { name?: unknown; color?: unknown }
    const updates: { name?: string; color?: string } = {}
    if (name !== undefined) {
      const cleaned = cleanName(name)
      if (!cleaned) return res.status(400).json({ error: "name cannot be empty" })
      updates.name = cleaned
    }
    if (color !== undefined) updates.color = cleanName(color)

    const renamed = updates.name !== undefined && updates.name !== category.name

    const [updated] = await db
      .update(categories)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(categories.id, id), eq(categories.organizationId, orgId)))
      .returning()

    // Keep existing transactions consistent: rename their stored category text
    // (org-scoped via the client). Transactions store the name, not a FK.
    if (renamed && updated) {
      await db
        .update(transactions)
        .set({ category: updated.name, updatedAt: new Date() })
        .where(
          and(
            eq(transactions.category, category.name),
            inArray(
              transactions.clientId,
              db.select({ id: clients.id }).from(clients).where(eq(clients.organizationId, orgId)),
            ),
          ),
        )
    }

    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Deleting a category leaves existing transactions' text intact (orphan-safe).
    await db
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.organizationId, orgId)))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
