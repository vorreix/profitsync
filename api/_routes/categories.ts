import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { categories } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"

const VALID_TYPES = ["incoming", "outgoing", "client", "quotation"]
const MAX_NAME_LENGTH = 60
const MAX_CATEGORIES_PER_ORG = 300

// Seeded/backfilled when an org opens its categories, so the transaction pickers
// are never empty and share sensible labels across income and expense flows.
const DEFAULT_TRANSACTION_CATEGORIES = [
  "Sales",
  "Services",
  "Subscriptions",
  "Rent",
  "Utilities",
  "Supplies",
  "Marketing",
  "Payroll",
  "Travel",
  "Taxes",
  "Other",
]

const DEFAULT_CATEGORIES: Record<string, string[]> = {
  incoming: DEFAULT_TRANSACTION_CATEGORIES,
  outgoing: DEFAULT_TRANSACTION_CATEGORIES,
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g")
function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NAME_LENGTH) : ""
}

async function ensureDefaultCategories(orgId: string) {
  // Seed only on FIRST access (the org has no categories at all). Re-seeding the
  // default names on every GET resurrected deleted defaults — a delete must stick.
  const [{ total }] = await db
    .select({ total: count() })
    .from(categories)
    .where(eq(categories.organizationId, orgId))
  if (total > 0) return

  const rows = Object.entries(DEFAULT_CATEGORIES).flatMap(([type, names]) =>
    names.map((name) => ({ organizationId: orgId, name, type })),
  )
  await db.insert(categories).values(rows).onConflictDoNothing()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method === "GET") {
    const { type } = req.query as { type?: string }

    await ensureDefaultCategories(orgId)

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
    const { name, type, types, color } = req.body as { name?: unknown; type?: unknown; types?: unknown; color?: unknown }
    const cleanedName = cleanName(name)
    if (!cleanedName) return res.status(400).json({ error: "name is required" })

    // Multi-type create: a logical category = one row per selected type. Accepts a
    // `types` array (new UI) and still accepts a single `type` (back-compat).
    const requestedTypes = Array.isArray(types)
      ? [...new Set(types.filter((t): t is string => typeof t === "string" && VALID_TYPES.includes(t)))]
      : typeof type === "string" && VALID_TYPES.includes(type)
        ? [type]
        : []
    if (requestedTypes.length === 0) {
      return res.status(400).json({ error: "Select at least one type" })
    }

    // Reject a name that collides with a DIFFERENT logical category (any casing) —
    // a logical category owns its name across all its types.
    const [clash] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), sql`lower(${categories.name}) = ${cleanedName.toLowerCase()}`, sql`${categories.name} <> ${cleanedName}`))
    if (clash) return res.status(409).json({ error: "A category with that name already exists" })

    const [{ total }] = await db
      .select({ total: count() })
      .from(categories)
      .where(eq(categories.organizationId, orgId))
    if (total + requestedTypes.length > MAX_CATEGORIES_PER_ORG) {
      return res.status(402).json({ error: "Category limit reached" })
    }

    const cleanColor = cleanName(color)
    // Unique on (org, type, name): onConflictDoNothing makes re-adding a type a no-op.
    await db
      .insert(categories)
      .values(requestedTypes.map((t) => ({ organizationId: orgId, name: cleanedName, type: t, color: cleanColor })))
      .onConflictDoNothing()

    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), eq(categories.name, cleanedName)))
    return res.status(201).json({ name: cleanedName, color: cleanColor, types: rows.map((r) => r.type).sort() })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
