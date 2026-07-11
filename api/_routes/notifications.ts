import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { notifications } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

// Cursor = "<createdAt ISO>|<id>" for keyset pagination over (created_at, id) desc.
function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString()
  return `${iso}|${id}`
}
function decodeCursor(cursor: string): { ts: Date; id: string } | null {
  const i = cursor.lastIndexOf("|")
  if (i <= 0) return null
  const ts = new Date(cursor.slice(0, i))
  const id = cursor.slice(i + 1)
  if (Number.isNaN(ts.getTime()) || !id) return null
  return { ts, id }
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(single(req.query.limit)) || DEFAULT_LIMIT))
  const filter = single(req.query.filter) === "unread" ? "unread" : "all"
  const category = single(req.query.category)
  const cursorRaw = single(req.query.cursor)

  // The bell is a PERSONAL inbox: a recipient sees ALL their own notifications
  // across every org they belong to, plus account-level (org-less) ones — never
  // filtered by the org they happen to be viewing. (Org-scoped filtering hid
  // cross-org events like a role change in a non-active org.)
  const scope = eq(notifications.userId, ctx.userId)

  const listConditions = [scope]
  if (filter === "unread") listConditions.push(isNull(notifications.readAt))
  if (category) listConditions.push(eq(notifications.category, category))
  if (cursorRaw) {
    const cur = decodeCursor(cursorRaw)
    if (cur) {
      listConditions.push(sql`(${notifications.createdAt}, ${notifications.id}) < (${cur.ts}, ${cur.id}::uuid)`)
    }
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...listConditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt as unknown as Date, last.id) : null

  // Unread count for the bell (always for the recipient's active-org scope).
  const [{ value: unreadCount }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(scope, isNull(notifications.readAt)))

  return res.json({
    notifications: page.map((r) => serialize(r)),
    next_cursor: nextCursor,
    unread_count: unreadCount,
  })
}
