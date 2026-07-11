import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { tags } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"
import { normalizeTagName } from "../../src/lib/tags.js"

const MAX_TAGS_PER_ORG = 300

type UsageRow = { k: string; name: string; c: string | number }

/**
 * Per-tag usage counts across the three taggable entities. Tags are stored as a
 * jsonb string array on each row; `jsonb_array_elements_text` unnests them so we
 * can group by the (case-insensitive) tag. Transactions are org-scoped through
 * their client; clients/quotations carry organization_id directly. Soft-deleted
 * rows are excluded so counts match what the drilldown shows.
 */
async function usageCounts(orgId: string) {
  const [tx, cl, qt] = await Promise.all([
    db.execute(sql`
      select lower(tag) as k, min(tag) as name, count(*)::int as c
      from (
        select jsonb_array_elements_text(t.tags) as tag
        from transactions t
        join clients c on c.id = t.client_id
        where c.organization_id = ${orgId} and t.deleted_at is null
      ) s group by lower(tag)`),
    db.execute(sql`
      select lower(tag) as k, min(tag) as name, count(*)::int as c
      from (
        select jsonb_array_elements_text(tags) as tag
        from clients
        where organization_id = ${orgId} and deleted_at is null
      ) s group by lower(tag)`),
    db.execute(sql`
      select lower(tag) as k, min(tag) as name, count(*)::int as c
      from (
        select jsonb_array_elements_text(tags) as tag
        from quotations
        where organization_id = ${orgId} and deleted_at is null
      ) s group by lower(tag)`),
  ])
  return {
    transactions: (tx.rows as UsageRow[]) ?? [],
    clients: (cl.rows as UsageRow[]) ?? [],
    quotations: (qt.rows as UsageRow[]) ?? [],
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method === "GET") {
    const [registry, usage] = await Promise.all([
      db.select().from(tags).where(eq(tags.organizationId, orgId)),
      usageCounts(orgId),
    ])

    // Merge registry rows and entity-present tags into one map keyed by the
    // lowercased tag, so an inline tag with no registry row still appears and a
    // registry row with no usage still shows (count 0). Registry name+color win.
    type Merged = {
      id: string | null; name: string; color: string
      transactions: number; clients: number; quotations: number; total: number
    }
    const map = new Map<string, Merged>()
    const bump = (rows: UsageRow[], key: "transactions" | "clients" | "quotations") => {
      for (const r of rows) {
        const k = r.k
        const cur = map.get(k) ?? { id: null, name: r.name, color: "", transactions: 0, clients: 0, quotations: 0, total: 0 }
        cur[key] += Number(r.c)
        cur.total += Number(r.c)
        map.set(k, cur)
      }
    }
    bump(usage.transactions, "transactions")
    bump(usage.clients, "clients")
    bump(usage.quotations, "quotations")

    for (const row of registry) {
      const k = row.name.toLowerCase()
      const cur = map.get(k) ?? { id: null, name: row.name, color: "", transactions: 0, clients: 0, quotations: 0, total: 0 }
      cur.id = row.id
      cur.name = row.name // registry spelling is canonical
      cur.color = row.color ?? ""
      map.set(k, cur)
    }

    const list = [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    return res.json(list)
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, color } = req.body as { name?: unknown; color?: unknown }
    const cleanedName = normalizeTagName(String(name ?? ""))
    if (!cleanedName) return res.status(400).json({ error: "name is required" })
    const cleanColor = typeof color === "string" ? color.trim().slice(0, 32) : ""

    // Case-insensitive de-dup (first spelling wins), mirroring entity tags: if a
    // registry row already exists for this tag under any casing, return it.
    const [existing] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.organizationId, orgId), sql`lower(${tags.name}) = ${cleanedName.toLowerCase()}`))
    if (existing) return res.status(200).json(serialize(existing))

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(tags)
      .where(eq(tags.organizationId, orgId))
    if (total >= MAX_TAGS_PER_ORG) return res.status(402).json({ error: "Tag limit reached" })

    const [row] = await db
      .insert(tags)
      .values({ organizationId: orgId, name: cleanedName, color: cleanColor })
      .onConflictDoNothing()
      .returning()
    if (row) return res.status(201).json(serialize(row))

    // Lost a race on the unique index — fetch and return the winner.
    const [winner] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.organizationId, orgId), eq(tags.name, cleanedName)))
    return res.status(200).json(serialize(winner))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
