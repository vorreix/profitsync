import { and, eq, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, quotations, transactions } from "../../src/lib/db/schema.js"
import { entityTags } from "../../src/lib/tags.js"

// Shared "show me every entity matching X" drilldown, used by both the tag and
// the category detail views. Each source table is queried with a caller-supplied
// match predicate (tag containment or category equality), normalized into one
// flat item shape, then merged + sorted in JS (cross-entity ordering can't be a
// single SQL ORDER BY). All queries are org-scoped and exclude soft-deleted rows.

export type DrilldownEntityType = "transaction" | "client" | "quotation"

export type DrilldownItem = {
  entity_type: DrilldownEntityType
  id: string
  title: string
  subtitle: string
  amount: string | null
  tx_type: string | null // "incoming" | "outgoing" for transactions
  status: string | null
  date: string | null
  category: string
  tags: string[]
  link: string
}

export type DrilldownSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc"

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

function dateRange(col: SQLWrapper, dateFrom?: string, dateTo?: string) {
  const from = isDate(dateFrom) ? sql`${col} >= ${dateFrom}::date` : undefined
  const to = isDate(dateTo) ? sql`${col} < (${dateTo}::date + interval '1 day')` : undefined
  return [from, to] as const
}

/** Transactions matching `match` (e.g. a tag containment or category equality). */
export async function fetchTransactionItems(
  orgId: string,
  match: SQL,
  opts: { dateFrom?: string; dateTo?: string } = {},
): Promise<DrilldownItem[]> {
  const [from, to] = dateRange(transactions.date, opts.dateFrom, opts.dateTo)
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      clientName: clients.name,
      amount: transactions.amount,
      type: transactions.type,
      date: transactions.date,
      category: transactions.category,
      tags: transactions.tags,
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(eq(clients.organizationId, orgId), isNull(transactions.deletedAt), isNull(clients.deletedAt), match, from, to))
  return rows.map((r) => ({
    entity_type: "transaction" as const,
    id: r.id,
    title: r.description?.trim() || "—",
    subtitle: r.clientName ?? "",
    amount: r.amount ?? null,
    tx_type: r.type ?? null,
    status: null,
    date: r.date ?? null,
    category: r.category ?? "",
    tags: entityTags(r),
    link: `/transactions?view=${r.id}`,
  }))
}

/** Clients matching `match`. */
export async function fetchClientItems(
  orgId: string,
  match: SQL,
  opts: { dateFrom?: string; dateTo?: string } = {},
): Promise<DrilldownItem[]> {
  const [from, to] = dateRange(clients.createdAt, opts.dateFrom, opts.dateTo)
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      company: clients.company,
      status: clients.status,
      createdAt: clients.createdAt,
      category: clients.category,
      tags: clients.tags,
    })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), match, from, to))
  return rows.map((r) => ({
    entity_type: "client" as const,
    id: r.id,
    title: r.name ?? "—",
    subtitle: r.company ?? "",
    amount: null,
    tx_type: null,
    status: r.status ?? null,
    date: r.createdAt ? new Date(r.createdAt).toISOString().split("T")[0] : null,
    category: r.category ?? "",
    tags: entityTags(r),
    link: `/clients/${r.id}`,
  }))
}

/** Quotations matching `match`. */
export async function fetchQuotationItems(
  orgId: string,
  match: SQL,
  opts: { dateFrom?: string; dateTo?: string } = {},
): Promise<DrilldownItem[]> {
  const [from, to] = dateRange(quotations.date, opts.dateFrom, opts.dateTo)
  const rows = await db
    .select({
      id: quotations.id,
      title: quotations.title,
      prospectName: quotations.prospectName,
      amount: quotations.amount,
      status: quotations.status,
      date: quotations.date,
      category: quotations.category,
      tags: quotations.tags,
    })
    .from(quotations)
    .where(and(eq(quotations.organizationId, orgId), isNull(quotations.deletedAt), match, from, to))
  return rows.map((r) => ({
    entity_type: "quotation" as const,
    id: r.id,
    title: r.title?.trim() || "—",
    subtitle: r.prospectName ?? "",
    amount: r.amount ?? null,
    tx_type: null,
    status: r.status ?? null,
    date: r.date ?? null,
    category: r.category ?? "",
    tags: entityTags(r),
    link: `/quotations?view=${r.id}`,
  }))
}

/** Stable cross-entity ordering of the merged item list. */
export function sortDrilldown(items: DrilldownItem[], sort: DrilldownSort): DrilldownItem[] {
  const amount = (i: DrilldownItem) => Number(i.amount ?? 0)
  const day = (i: DrilldownItem) => i.date ?? ""
  const arr = [...items]
  switch (sort) {
    case "date_asc":
      return arr.sort((a, b) => day(a).localeCompare(day(b)) || a.title.localeCompare(b.title))
    case "amount_desc":
      return arr.sort((a, b) => amount(b) - amount(a) || day(b).localeCompare(day(a)))
    case "amount_asc":
      return arr.sort((a, b) => amount(a) - amount(b) || day(b).localeCompare(day(a)))
    case "name_asc":
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    case "date_desc":
    default:
      return arr.sort((a, b) => day(b).localeCompare(day(a)) || a.title.localeCompare(b.title))
  }
}
