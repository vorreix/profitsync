import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { categories, clients, quotations, transactions } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"

const VALID_TYPES = ["incoming", "outgoing", "client", "quotation"]
const MAX_NAME_LENGTH = 60
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g")
function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NAME_LENGTH) : ""
}

function cleanTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((t): t is string => typeof t === "string" && VALID_TYPES.includes(t)))]
}

/** Rename a category label across every entity that stored it as free text. */
async function cascadeRename(orgId: string, oldName: string, newName: string) {
  const orgClientIds = db.select({ id: clients.id }).from(clients).where(eq(clients.organizationId, orgId))
  await db
    .update(transactions)
    .set({ category: newName, updatedAt: new Date() })
    .where(and(eq(transactions.category, oldName), inArray(transactions.clientId, orgClientIds)))
  await db
    .update(clients)
    .set({ category: newName, updatedAt: new Date() })
    .where(and(eq(clients.organizationId, orgId), eq(clients.category, oldName)))
  await db
    .update(quotations)
    .set({ category: newName, updatedAt: new Date() })
    .where(and(eq(quotations.organizationId, orgId), eq(quotations.category, oldName)))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  // Edit a LOGICAL category = all rows sharing (org, name). Renames + re-colors +
  // adds/removes per-type rows in one pass, then cascades the rename to entities.
  if (req.method === "PUT") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { oldName, newName, types, color } = req.body as {
      oldName?: unknown; newName?: unknown; types?: unknown; color?: unknown
    }
    const cleanedOld = cleanName(oldName)
    const cleanedNew = cleanName(newName)
    const finalTypes = cleanTypes(types)
    if (!cleanedOld) return res.status(400).json({ error: "oldName is required" })
    if (!cleanedNew) return res.status(400).json({ error: "name is required" })
    if (finalTypes.length === 0) return res.status(400).json({ error: "Select at least one type" })

    const existing = await db
      .select()
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), eq(categories.name, cleanedOld)))
    if (existing.length === 0) return res.status(404).json({ error: "Not found" })

    const renaming = cleanedNew !== cleanedOld
    // Reject a name that collides with a DIFFERENT logical category (case-insensitive).
    if (renaming && cleanedNew.toLowerCase() !== cleanedOld.toLowerCase()) {
      const [clash] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.organizationId, orgId), sql`lower(${categories.name}) = ${cleanedNew.toLowerCase()}`))
      if (clash) return res.status(409).json({ error: "A category with that name already exists" })
    }

    const currentTypes = new Set(existing.map((e) => e.type))
    const wanted = new Set(finalTypes)
    const finalColor = color !== undefined ? cleanName(color) : (existing[0].color ?? "")

    // 1. Drop rows for de-selected types.
    const toDelete = [...currentTypes].filter((t) => !wanted.has(t))
    if (toDelete.length) {
      await db
        .delete(categories)
        .where(and(eq(categories.organizationId, orgId), eq(categories.name, cleanedOld), inArray(categories.type, toDelete)))
    }
    // 2. Rename + recolor the kept rows.
    const toKeep = [...currentTypes].filter((t) => wanted.has(t))
    if (toKeep.length) {
      await db
        .update(categories)
        .set({ name: cleanedNew, color: finalColor, updatedAt: new Date() })
        .where(and(eq(categories.organizationId, orgId), eq(categories.name, cleanedOld), inArray(categories.type, toKeep)))
    }
    // 3. Insert rows for newly-selected types.
    const toInsert = [...wanted].filter((t) => !currentTypes.has(t))
    if (toInsert.length) {
      await db
        .insert(categories)
        .values(toInsert.map((type) => ({ organizationId: orgId, name: cleanedNew, type, color: finalColor })))
        .onConflictDoNothing()
    }
    // 4. Cascade the rename onto stored entity labels.
    if (renaming) await cascadeRename(orgId, cleanedOld, cleanedNew)

    return res.json({ name: cleanedNew, color: finalColor, types: [...wanted].sort() })
  }

  // Delete a LOGICAL category = every row sharing the name. Entity free-text is
  // left intact (orphan-safe), matching the single-row DELETE.
  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const name = cleanName((req.query as { name?: string }).name)
    if (!name) return res.status(400).json({ error: "name is required" })
    await db.delete(categories).where(and(eq(categories.organizationId, orgId), eq(categories.name, name)))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
