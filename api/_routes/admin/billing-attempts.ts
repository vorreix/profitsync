import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { billingAttempts } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { ABANDONED_AFTER_MS, ATTEMPT_STATUSES, effectiveStatus } from "../../_lib/billing-attempts.js"

const PAGE_SIZE = 30

/**
 * GET /api/admin/billing-attempts — every checkout attempt with funnel counts.
 * Filters: ?status= (EFFECTIVE status — stale in-flight rows count as
 * abandoned), ?plan=, ?from=, ?to= (ISO dates), ?search= (org name or email),
 * ?page=. Counts respect every filter except status (so the funnel chips stay
 * stable while drilling into one status).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdminCap(req, res, "read")
  if (!admin) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { status, plan, from, to, search, page } = req.query as {
    status?: string; plan?: string; from?: string; to?: string; search?: string; page?: string
  }

  const now = new Date()
  const staleCutoff = new Date(now.getTime() - ABANDONED_AFTER_MS)

  const baseFilters: SQL[] = []
  if (plan?.trim()) baseFilters.push(sql`${billingAttempts.planKey} = ${plan.trim()}`)
  if (from?.trim()) baseFilters.push(gte(billingAttempts.createdAt, new Date(from.trim())))
  if (to?.trim()) baseFilters.push(lte(billingAttempts.createdAt, new Date(`${to.trim()}T23:59:59.999Z`)))
  if (search?.trim()) {
    // Escape LIKE wildcards — Drizzle parameterizes the VALUE but % and _ are
    // still pattern metacharacters inside it (worst case: pathological scans).
    const escaped = search.trim().replace(/[\\%_]/g, "\\$&").slice(0, 100)
    const q = `%${escaped}%`
    const match = or(ilike(billingAttempts.organizationName, q), ilike(billingAttempts.ownerEmail, q))
    if (match) baseFilters.push(match)
  }

  // Effective-status condition: terminal stored statuses match directly;
  // "abandoned" additionally includes stale in-flight rows; "created"/
  // "redirected" exclude them.
  let statusFilter: SQL | undefined
  if (status && ATTEMPT_STATUSES.includes(status as (typeof ATTEMPT_STATUSES)[number])) {
    if (status === "abandoned") {
      statusFilter = sql`(${billingAttempts.status} = 'abandoned' or (${billingAttempts.status} in ('created','redirected') and ${billingAttempts.createdAt} < ${staleCutoff}))`
    } else if (status === "created" || status === "redirected") {
      statusFilter = sql`(${billingAttempts.status} = ${status} and ${billingAttempts.createdAt} >= ${staleCutoff})`
    } else {
      statusFilter = sql`${billingAttempts.status} = ${status}`
    }
  }

  const pageNum = Math.max(1, Number(page) || 1)
  const where = baseFilters.length || statusFilter ? and(...baseFilters, ...(statusFilter ? [statusFilter] : [])) : undefined
  const baseWhere = baseFilters.length ? and(...baseFilters) : undefined

  const [rows, [{ total }], allForCounts] = await Promise.all([
    db
      .select()
      .from(billingAttempts)
      .where(where)
      .orderBy(desc(billingAttempts.createdAt))
      .limit(PAGE_SIZE)
      .offset((pageNum - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(billingAttempts).where(where),
    // Funnel counts via grouped effective status (cheap: one grouped scan).
    db
      .select({
        bucket: sql<string>`case
          when ${billingAttempts.status} in ('completed','failed','abandoned') then ${billingAttempts.status}
          when ${billingAttempts.createdAt} < ${staleCutoff} then 'abandoned'
          else ${billingAttempts.status}
        end`,
        n: count(),
      })
      .from(billingAttempts)
      .where(baseWhere)
      .groupBy(sql`1`),
  ])

  const counts: Record<string, number> = { created: 0, redirected: 0, completed: 0, failed: 0, abandoned: 0 }
  for (const c of allForCounts) counts[c.bucket] = Number(c.n)

  return res.json({
    data: rows.map((r) => serialize({ ...r, effectiveStatus: effectiveStatus(r.status, r.createdAt, now) })),
    total: Number(total),
    page: pageNum,
    page_size: PAGE_SIZE,
    counts,
  })
}
