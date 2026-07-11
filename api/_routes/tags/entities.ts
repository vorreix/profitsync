import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sql, type AnyColumn } from "drizzle-orm"
import { clients, quotations, transactions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { normalizeTagName } from "../../../src/lib/tags.js"
import {
  fetchClientItems,
  fetchQuotationItems,
  fetchTransactionItems,
  sortDrilldown,
  type DrilldownEntityType,
  type DrilldownSort,
} from "../../_lib/entity-drilldown.js"

const ALL_TYPES: DrilldownEntityType[] = ["transaction", "client", "quotation"]
const SORTS = new Set(["date_desc", "date_asc", "amount_desc", "amount_asc", "name_asc"])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { tag, types, dateFrom, dateTo, sort } = req.query as {
    tag?: string; types?: string; dateFrom?: string; dateTo?: string; sort?: string
  }
  const normalizedTag = normalizeTagName(String(tag ?? ""))
  if (!normalizedTag) return res.status(400).json({ error: "tag is required" })

  const requested = types
    ? new Set(types.split(",").map((t) => t.trim()).filter((t): t is DrilldownEntityType => (ALL_TYPES as string[]).includes(t)))
    : new Set(ALL_TYPES)
  const included = requested.size ? requested : new Set(ALL_TYPES)
  const chosenSort = (SORTS.has(String(sort)) ? sort : "date_desc") as DrilldownSort
  const opts = { dateFrom, dateTo }
  const contains = (col: AnyColumn) => sql`${col} @> ${JSON.stringify([normalizedTag])}::jsonb`

  const [txItems, clItems, qtItems] = await Promise.all([
    included.has("transaction") ? fetchTransactionItems(orgId, contains(transactions.tags), opts) : Promise.resolve([]),
    included.has("client") ? fetchClientItems(orgId, contains(clients.tags), opts) : Promise.resolve([]),
    included.has("quotation") ? fetchQuotationItems(orgId, contains(quotations.tags), opts) : Promise.resolve([]),
  ])

  const items = sortDrilldown([...txItems, ...clItems, ...qtItems], chosenSort)
  return res.json({
    tag: normalizedTag,
    items,
    counts: { transaction: txItems.length, client: clItems.length, quotation: qtItems.length },
  })
}
