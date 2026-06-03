import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { categories } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"

const VALID_TYPES = ["incoming", "outgoing", "client", "quotation"]
const MAX_NAME_LENGTH = 60
const MAX_CATEGORIES_PER_ORG = 300

// Seeded the first time an org opens its categories, so the picker is never empty.
const DEFAULT_CATEGORIES: Record<string, string[]> = {
  incoming: ["Payment", "Retainer", "Project Fee", "Consultation", "Other"],
  outgoing: ["Hosting", "Design", "Development", "Advertising", "Salary", "Software", "Travel", "Taxes", "Miscellaneous"],
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g")
function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NAME_LENGTH) : ""
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method === "GET") {
    const { type } = req.query as { type?: string }

    // Seed defaults on first access for this org.
    const [{ total }] = await db
      .select({ total: count() })
      .from(categories)
      .where(eq(categories.organizationId, orgId))
    if (total === 0) {
      const rows = Object.entries(DEFAULT_CATEGORIES).flatMap(([t, names]) =>
        names.map((name) => ({ organizationId: orgId, name, type: t })),
      )
      await db.insert(categories).values(rows).onConflictDoNothing()
    }

    const where =
      type && VALID_TYPES.includes(type)
        ? and(eq(categories.organizationId, orgId), eq(categories.type, type))
        : eq(categories.organizationId, orgId)

    const rows = await db
      .select()
      .from(categories)
      .where(where)
      .orderBy(asc(categories.type), asc(categories.name))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, type, color } = req.body as { name?: unknown; type?: unknown; color?: unknown }
    const cleanedName = cleanName(name)
    if (!cleanedName) return res.status(400).json({ error: "name is required" })
    if (typeof type !== "string" || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }

    const [{ total }] = await db
      .select({ total: count() })
      .from(categories)
      .where(eq(categories.organizationId, orgId))
    if (total >= MAX_CATEGORIES_PER_ORG) {
      return res.status(402).json({ error: "Category limit reached" })
    }

    // Unique on (org, type, name): return the existing row instead of erroring.
    const [row] = await db
      .insert(categories)
      .values({ organizationId: orgId, name: cleanedName, type, color: cleanName(color) })
      .onConflictDoNothing()
      .returning()
    if (row) return res.status(201).json(serialize(row))

    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), eq(categories.type, type), eq(categories.name, cleanedName)))
    return res.status(200).json(serialize(existing))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
