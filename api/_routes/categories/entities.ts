import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, sql } from "drizzle-orm"
import { clients, quotations, transactions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import {
  fetchClientItems,
  fetchQuotationItems,
  fetchTransactionItems,
  sortDrilldown,
  type DrilldownSort,
} from "../../_lib/entity-drilldown.js"

// A category's `types` are CategoryType values (incoming/outgoing/client/quotation),
// which is a finer split than entity type: "incoming"/"outgoing" both live on the
// transactions table but constrain tx.type. So the type filter maps to (a) which
// tables to query and (b) an extra tx.type predicate.
const CATEGORY_TYPES = ["incoming", "outgoing", "client", "quotation"]
const SORTS = new Set(["date_desc", "date_asc", "amount_desc", "amount_asc", "name_asc"])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { name, types, dateFrom, dateTo, sort } = req.query as {
    name?: string; types?: string; dateFrom?: string; dateTo?: string; sort?: string
  }
  const cleanedName = typeof name === "string" ? name.trim().slice(0, 60) : ""
  if (!cleanedName) return res.status(400).json({ error: "name is required" })
  const nameLower = cleanedName.toLowerCase()

  const requested = types
    ? new Set(types.split(",").map((t) => t.trim()).filter((t) => CATEGORY_TYPES.includes(t)))
    : new Set(CATEGORY_TYPES)
  const included = requested.size ? requested : new Set(CATEGORY_TYPES)
  const chosenSort = (SORTS.has(String(sort)) ? sort : "date_desc") as DrilldownSort
  const opts = { dateFrom, dateTo }

  const wantIncoming = included.has("incoming")
  const wantOutgoing = included.has("outgoing")
  const catEq = (col: Parameters<typeof eq>[0]) => sql`lower(${col}) = ${nameLower}`

  // Transactions: match category, and constrain tx.type when only one side is asked.
  let txMatch: ReturnType<typeof sql> | undefined
  if (wantIncoming || wantOutgoing) {
    const base = catEq(transactions.category)
    if (wantIncoming && wantOutgoing) txMatch = base
    else txMatch = and(base, eq(transactions.type, wantIncoming ? "incoming" : "outgoing")) as ReturnType<typeof sql>
  }

  const [txItems, clItems, qtItems] = await Promise.all([
    txMatch ? fetchTransactionItems(orgId, txMatch, opts) : Promise.resolve([]),
    included.has("client") ? fetchClientItems(orgId, catEq(clients.category), opts) : Promise.resolve([]),
    included.has("quotation") ? fetchQuotationItems(orgId, catEq(quotations.category), opts) : Promise.resolve([]),
  ])

  const items = sortDrilldown([...txItems, ...clItems, ...qtItems], chosenSort)
  return res.json({
    name: cleanedName,
    items,
    counts: {
      incoming: txItems.filter((i) => i.tx_type === "incoming").length,
      outgoing: txItems.filter((i) => i.tx_type === "outgoing").length,
      client: clItems.length,
      quotation: qtItems.length,
    },
  })
}
