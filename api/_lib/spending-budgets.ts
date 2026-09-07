import { and, asc, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { auditLogs, clients, spendingBudgets, transactions } from "../../src/lib/db/schema.js"
import type { AmountChange } from "../../src/lib/budget.js"
import {
  budgetState,
  budgetWindow,
  categoriesWithin,
  categoryKey,
  categoryOverlap,
  daysLeft,
  isIsoDate,
  isSpendingPeriod,
  lastChangedAt,
  limitAt,
  limitForWindow,
  normaliseCategories,
  perDayLeft,
  viewRange,
  windowPhase,
  windowsBack,
  type BudgetWindow,
  type SpendingPeriod,
  type ViewWindow,
} from "../../src/lib/budget.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import type { SpendingBudget, SpendingBudgetHistoryEntry, SpendingBudgetRecentTx, SpendingBudgetStatus } from "../../src/lib/types.js"
import { budgetSpendPredicates, budgetSpendSignedAmount } from "./budget-spend.js"

// ─────────────────────────────────────────────────────────────────────────────
// Spending budgets — the DB side of src/lib/budget.ts.
//
// Three rules keep this honest:
//   • Spend is NEVER stored. Every figure is summed from the ledger for the
//     budget's current window, with the same six predicates the v1 client caps
//     use (`budgetSpendPredicates`): org-scoped through clients, not trashed,
//     not a system balance row, standard outgoing + refunds (negative), never a
//     transfer — so paying a credit card is not spending, the purchase was.
//   • ONE aggregate statement serves every budget. Neon HTTP is ~200 ms a round
//     trip, so N budgets must not cost N queries: each budget becomes one
//     `sum(...) filter (where <its window> and <its scope>)` column.
//   • The category match is `lower(btrim(coalesce(category,'')))` — what
//     `categoryKey()` mirrors in JS, so two spellings of one category are one
//     category. `transactions_category_key_idx` indexes that expression and
//     serves the WHERE-level matches (recentFor, seriesFor); the aggregate
//     projects the key once per row and filters on it per column instead.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_TOP_LEVEL = 40
export const MAX_CHILDREN = 20
export const MAX_CATEGORIES = 50
export const MAX_NAME = 60
export const MAX_ICON = 32

/** Past windows the detail chart shows, per cadence. */
export const SERIES_BACK: Record<SpendingPeriod, number> = { daily: 14, weekly: 8, monthly: 6, yearly: 3, once: 0 }

/** The stored row as the client sees it (snake_case, numbers parsed) — the view minus its derived figures. */
export type SpendingBudgetRecord = Omit<
  SpendingBudget,
  | "is_overall"
  | "window"
  | "spent"
  | "spent_by_view"
  | "remaining"
  | "ratio"
  | "state"
  | "per_day_left"
  | "other_spent"
  | "other_spent_by_view"
  | "children_count"
> & { created_by: string | null; updated_by: string | null }

/** With the live figures attached — exactly `SpendingBudget` in src/lib/types.ts. */
export type SpendingBudgetView = SpendingBudget
export type { SpendingBudgetStatus }

type Row = typeof spendingBudgets.$inferSelect

const money = (n: number) => Math.round(n * 100) / 100

export function toRecord(row: Row): SpendingBudgetRecord {
  const s = serialize(row) as unknown as SpendingBudgetRecord & { amount: unknown; categories: unknown }
  return {
    ...s,
    amount: Number(s.amount),
    categories: Array.isArray(s.categories) ? (s.categories as unknown[]).filter((c): c is string => typeof c === "string") : [],
    period: isSpendingPeriod(row.period) ? row.period : "monthly",
    status: row.status === "closed" ? "closed" : "active",
  }
}

/**
 * The window a transaction falls in, as YYYY-MM-DD.
 *
 * The unit is inlined rather than bound: drizzle numbers each bind separately,
 * so `date_trunc($1, …)` in the SELECT and `date_trunc($2, …)` in the GROUP BY
 * are two different expressions to Postgres and it refuses the query
 * ("column must appear in the GROUP BY clause"). `unit` comes from a fixed set,
 * never from a request.
 */
function truncBucket(unit: "day" | "week" | "month" | "year") {
  return sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${transactions.date}::timestamp), 'YYYY-MM-DD')`
}

/** The normalised category key — the expression `transactions_category_key_idx` indexes. */
const CATEGORY_KEY_SQL = sql`lower(btrim(coalesce(${transactions.category}, '')))`

/** "this row's category is one of these", against an already-projected key column. */
function scopeOn(ckey: SQL, categories: string[]): SQL {
  const keys = [...new Set(categories.map(categoryKey).filter(Boolean))]
  if (!keys.length) return sql`true`
  return sql`${ckey} in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`
}

/** The WHERE-level scope match on the base table (recentFor / seriesFor — where the index applies). */
function scopeSql(categories: string[]): SQL {
  return scopeOn(CATEGORY_KEY_SQL, categories)
}

function windowOn(dateCol: SQL, w: BudgetWindow): SQL {
  const parts: SQL[] = []
  if (w.start) parts.push(sql`${dateCol} >= ${w.start}`)
  if (w.endExclusive) parts.push(sql`${dateCol} < ${w.endExclusive}`)
  return parts.length ? sql.join(parts, sql` and `) : sql`true`
}

function windowSql(w: BudgetWindow): SQL {
  return windowOn(sql`${transactions.date}`, w)
}

export type SpendItem = {
  key: string
  window: BudgetWindow
  categories: string[]
  /** Rows in these categories are left OUT (the "not in any sub-budget" remainder). */
  exclude?: string[]
}

/**
 * One aggregate statement for a set of items: the base rows are projected once
 * (signed amount, date, category key) and each item becomes one
 * `sum(...) filter (where <its window> and <its scope>)` column over them, so
 * the key expression is evaluated once per row rather than once per column.
 * `lowerBound` is the shared `date >=` that lets the planner use the
 * (client_id, date) index; omitted for the all-time set.
 */
async function aggregate(orgId: string, items: SpendItem[], lowerBound: string | null): Promise<[string, number][]> {
  const conds = [...budgetSpendPredicates(orgId)]
  if (lowerBound) conds.push(gte(transactions.date, lowerBound))
  const base = db
    .select({
      signed: budgetSpendSignedAmount.as("signed"),
      date: transactions.date,
      ckey: CATEGORY_KEY_SQL.as("ckey"),
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...conds))
    .as("t")

  const columns: Record<string, SQL<string>> = {}
  items.forEach((it, i) => {
    const excl = it.exclude?.length ? sql` and not (${scopeOn(sql`${base.ckey}`, it.exclude)})` : sql``
    columns[`b${i}`] = sql<string>`coalesce(sum(${base.signed}) filter (where ${windowOn(sql`${base.date}`, it.window)} and ${scopeOn(sql`${base.ckey}`, it.categories)}${excl}), 0)`
  })
  const [row] = await db.select(columns).from(base)
  return items.map((it, i) => [it.key, money(Number(row?.[`b${i}`] ?? 0))])
}

/**
 * Spend per item for its own window and scope. Items with a lower bound share
 * ONE statement that keeps the date index; the all-time ones (a `once` budget
 * with no start) share another that must read the whole ledger — the two run
 * concurrently, so wall time stays one round trip and an all-time budget never
 * costs the bounded ones their index. Returns cents-rounded signed totals.
 */
export async function spendByItem(orgId: string, items: SpendItem[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!items.length) return out
  const bounded = items.filter((it) => !!it.window.start)
  const open = items.filter((it) => !it.window.start)
  const floor = bounded.length ? bounded.map((it) => it.window.start!).reduce((a, b) => (a < b ? a : b)) : null
  const results = await Promise.all([
    bounded.length ? aggregate(orgId, bounded, floor) : Promise.resolve([] as [string, number][]),
    open.length ? aggregate(orgId, open, null) : Promise.resolve([] as [string, number][]),
  ])
  for (const list of results) for (const [k, v] of list) out.set(k, v)
  return out
}

/**
 * Every budget of the org, by position. A sub-budget's period and dates are
 * its PARENT's, resolved here on every read rather than copied on write — so
 * there is nothing to keep in sync, and no moment in which a parent has moved
 * to a new window and its children have not.
 */
export async function loadRecords(orgId: string): Promise<SpendingBudgetRecord[]> {
  const rows = await db
    .select()
    .from(spendingBudgets)
    .where(eq(spendingBudgets.organizationId, orgId))
    .orderBy(asc(spendingBudgets.position), asc(spendingBudgets.createdAt))
  const records = rows.map(toRecord)
  const byId = new Map(records.map((r) => [r.id, r]))
  return records.map((r) => {
    const parent = r.parent_id ? byId.get(r.parent_id) : null
    return parent ? { ...r, period: parent.period, start_date: parent.start_date, end_date: parent.end_date } : r
  })
}

const VIEWS = ["daily", "weekly", "monthly", "yearly"] as const

/**
 * Attach the live figures to a set of records for `today`.
 *
 * Every budget is measured in its OWN authored window — that is what "am I over
 * budget?" means, and it is what the alerts, the dashboard card and the
 * transaction-form hint all read — AND in each of the four view windows, so the
 * page's Day / Week / Month / Year toggle is a re-render rather than a request.
 * It is still ONE statement: each distinct (window, scope) pair is one more
 * `sum(...) filter (...)` column, so a monthly budget read in the month view
 * costs nothing extra.
 *
 * `all` must contain every record of the org (children included) so a parent's
 * remainder can be derived. That remainder is a subtraction, exact only because
 * sub-budgets are disjoint and inside their parent's scope — the rules
 * `checkRelations` enforces on every write. It is clamped anyway.
 */
export async function withSpend(
  orgId: string,
  records: SpendingBudgetRecord[],
  today: string,
  all: SpendingBudgetRecord[] = records,
): Promise<SpendingBudgetView[]> {
  const childrenOf = new Map<string, SpendingBudgetRecord[]>()
  for (const r of all) {
    if (!r.parent_id) continue
    childrenOf.set(r.parent_id, [...(childrenOf.get(r.parent_id) ?? []), r])
  }

  const items: SpendItem[] = []
  const columnFor = new Map<string, string>()
  const column = (window: BudgetWindow, categories: string[]) => {
    const key = `${window.start ?? "*"}|${window.endExclusive ?? "*"}|${categories.map(categoryKey).sort().join("\u0000")}`
    const existing = columnFor.get(key)
    if (existing) return existing
    const id = `c${columnFor.size}`
    columnFor.set(key, id)
    items.push({ key: id, window, categories })
    return id
  }

  const plan = records.map((r) => {
    const authored = budgetWindow(r.period, r, today)
    const authoredCol = column(authored, r.categories)
    // A custom-date budget is a fixed sum over fixed dates: it does not convert,
    // so every view reports the same figure — its own.
    const viewCols = Object.fromEntries(
      VIEWS.map((v) => [v, r.period === "once" ? authoredCol : column(viewRange(v, today), r.categories)]),
    ) as Record<(typeof VIEWS)[number], string>
    return { r, authored, authoredCol, viewCols }
  })

  const spent = await spendByItem(orgId, items)
  const spentOf = (id: string) => spent.get(id) ?? 0
  const byId = new Map(plan.map((p) => [p.r.id, p]))

  return plan.map(({ r, authored, authoredCol, viewCols }) => {
    const s = spentOf(authoredCol)
    const phase = windowPhase(authored, today)
    const days = daysLeft(authored, today)
    const { ratio, remaining, state } = budgetState(s, r.amount)
    const kids = childrenOf.get(r.id) ?? []
    const activeKids = kids.filter((k) => k.status === "active")
    const counted = r.status === "active" && r.amount > 0 && phase === "active"
    const spent_by_view = Object.fromEntries(VIEWS.map((v) => [v, spentOf(viewCols[v])])) as Record<(typeof VIEWS)[number], number>
    const restIn = (get: (p: (typeof plan)[number]) => number) =>
      money(Math.max(0, get(byId.get(r.id)!) - activeKids.reduce((sum, k) => { const p = byId.get(k.id); return sum + (p ? get(p) : 0) }, 0)))
    return {
      ...r,
      is_overall: !r.parent_id && r.categories.length === 0,
      window: { start: authored.start, end_exclusive: authored.endExclusive, phase, days_left: days },
      spent: s,
      spent_by_view,
      remaining: money(remaining),
      ratio: r.amount > 0 && Number.isFinite(ratio) ? Math.round(ratio * 10_000) / 10_000 : null,
      state: counted ? state : "none",
      per_day_left: counted ? perDayLeft(remaining, days) : null,
      other_spent: activeKids.length ? restIn((p) => spentOf(p.authoredCol)) : null,
      other_spent_by_view: activeKids.length
        ? (Object.fromEntries(VIEWS.map((v) => [v, restIn((p) => spentOf(p.viewCols[v]))])) as Record<(typeof VIEWS)[number], number>)
        : null,
      children_count: kids.length,
    }
  })
}

/** Every budget measured in its OWN authored window — for alerts and the v1 API shim. */
export async function listBudgets(orgId: string, today: string): Promise<SpendingBudgetView[]> {
  const all = await loadRecords(orgId)
  return withSpend(orgId, all, today, all)
}

/**
 * A category rename must move the budgets that named it (or their spend would
 * silently drop to zero) — but not into a clash. Plans the rewrite, case-
 * insensitively and deduped, and refuses it when two sub-budgets of one main
 * budget would end up claiming the same category.
 */
export async function planCategoryRename(
  orgId: string,
  oldName: string,
  newName: string,
): Promise<{ updates: { id: string; categories: string[] }[]; clash: { a: string; b: string; categories: string[] } | null }> {
  const oldKey = categoryKey(oldName)
  if (!oldKey || (categoryKey(newName) === oldKey && oldName === newName)) return { updates: [], clash: null }
  const all = await loadRecords(orgId)
  const next = new Map(all.map((r) => [r.id, r.categories]))
  const updates: { id: string; categories: string[] }[] = []
  for (const r of all) {
    if (!r.categories.some((c) => categoryKey(c) === oldKey)) continue
    const categories = normaliseCategories(r.categories.map((c) => (categoryKey(c) === oldKey ? newName : c)))
    next.set(r.id, categories)
    updates.push({ id: r.id, categories })
  }
  // Every sibling group, top level included — a rename must not make two
  // budgets at the same level claim one category. The overall budget (empty
  // scope) is skipped: covering everything is its job.
  const groups = new Set(all.map((r) => r.parent_id ?? "top"))
  for (const group of groups) {
    const peers = all.filter((r) => (r.parent_id ?? "top") === group && next.get(r.id)!.length > 0)
    for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        const clash = categoryOverlap(next.get(peers[i].id)!, next.get(peers[j].id)!)
        if (clash.length) return { updates, clash: { a: peers[i].name, b: peers[j].name, categories: clash } }
      }
    }
  }
  return { updates, clash: null }
}

/** Apply a planned rename. */
export async function applyCategoryRename(updates: { id: string; categories: string[] }[]): Promise<void> {
  await Promise.all(
    updates.map((u) =>
      db.update(spendingBudgets).set({ categories: u.categories, updatedAt: new Date() }).where(eq(spendingBudgets.id, u.id)),
    ),
  )
}

/**
 * The one budget an old (v1) client means by "the personal budget": top level,
 * all spending, active — the migrated row (name '') first, else the earliest.
 */
export function primaryBudget<T extends { parent_id: string | null; categories: string[]; name: string; status: string }>(budgets: T[]): T | null {
  const candidates = budgets.filter((b) => !b.parent_id && b.categories.length === 0 && b.status === "active")
  return candidates.find((b) => b.name === "") ?? candidates[0] ?? null
}

/** v3 → the v1 vocabulary an old bundle understands (yearly and custom read as "lifetime"). */
export function toV1Period(period: SpendingPeriod): "lifetime" | "monthly" | "weekly" | "daily" {
  return period === "daily" || period === "weekly" || period === "monthly" ? period : "lifetime"
}

/** v1 → v3: `lifetime` is a `once` budget with no dates. */
export function fromV1Period(period: "lifetime" | "monthly" | "weekly" | "daily"): SpendingPeriod {
  return period === "lifetime" ? "once" : period
}

/** Spend per past window for the detail chart, one grouped query. */
export async function seriesFor(
  orgId: string,
  budget: Pick<SpendingBudgetRecord, "period" | "categories">,
  windows: BudgetWindow[],
): Promise<{ start: string; spent: number }[]> {
  if (!windows.length) return []
  const unit = budget.period === "daily" ? "day" : budget.period === "weekly" ? "week" : budget.period === "yearly" ? "year" : "month"
  const first = windows[0].start!
  const last = windows[windows.length - 1].endExclusive!
  // date_trunc('week') is ISO — Monday-based — which is the app's week too.
  const bucket = truncBucket(unit)
  const rows = await db
    .select({ start: bucket, spent: sql<string>`coalesce(sum(${budgetSpendSignedAmount}), 0)` })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...budgetSpendPredicates(orgId), sql`${transactions.date} >= ${first}`, sql`${transactions.date} < ${last}`, scopeSql(budget.categories)))
    .groupBy(bucket)
  const byStart = new Map(rows.map((r) => [r.start, money(Number(r.spent))]))
  return windows.map((w) => ({ start: w.start!, spent: byStart.get(w.start!) ?? 0 }))
}

export type BudgetAnalyticsWindow = {
  start: string
  end_exclusive: string
  /** The window has not finished — it is drawn "so far" and never judged. */
  partial: boolean
  /**
   * The figures for this window can be trusted: a budget's scope has not moved
   * since it closed. Folding today's categories onto an older window would
   * otherwise rewrite history silently.
   */
  reliable: boolean
  /** Every counted row in the window — the honest total, whatever is budgeted. */
  total: number
  /** Spend no ACTIVE category budget claims: the money nothing is watching. Never negative. */
  unclaimed: number
  /** The overall budget's cap as it was when this window closed; null before it existed. */
  overall_limit: number | null
  /** Σ of the category budgets' caps as they were then. */
  budgeted_limit: number
  /** budget id → its own cap in this window; null before it existed. */
  per_budget_limit: Record<string, number | null>
  /**
   * budget id → spend in this window. NOT a partition: the overall budget's
   * entry equals `total` and a sub-budget's is already inside its parent's, so
   * never sum this map — read the entry you want.
   */
  per_budget: Record<string, number>
}

export type BudgetAnalytics = {
  view: ViewWindow
  back: number
  today: string
  windows: BudgetAnalyticsWindow[]
  /** Where the money actually went in the CURRENT window, biggest first. */
  categories: { name: string; spent: number; budget_id: string | null }[]
  /** How the closed, judgeable windows went against the limit that applied then. */
  adherence: { periods: number; within: number; rate: number; streak: number; avg_delta: number }
}

/**
 * The analytics screen, in THREE round trips whatever the size of the plan: the
 * budget rows, then one grouped read of the ledger (window × category key) and
 * one of the audit trail, concurrently. Folding those rows onto budgets in JS
 * is only legitimate because sibling scopes are disjoint — a category key
 * belongs to at most one budget per level, so nothing is counted twice.
 *
 * Two rules keep the verdicts honest:
 *   • a window is judged against the limit that applied WHEN IT CLOSED, and is
 *     not judged at all before the budget existed (`limitAt` → null); and
 *   • the open window is never judged, because month-to-date spend is trivially
 *     under any limit on the 3rd.
 */
export async function analyticsFor(orgId: string, today: string, view: ViewWindow, back: number): Promise<BudgetAnalytics> {
  const all = await loadRecords(orgId)
  const windows = windowsBack(view, back, today)
  const first = windows[0].start!
  const last = windows[windows.length - 1].endExclusive!
  const unit = view === "daily" ? "day" : view === "weekly" ? "week" : view === "yearly" ? "year" : "month"

  // date_trunc('week') is ISO (Monday-based) — the same week the app cuts.
  const bucket = truncBucket(unit)
  const [rows, audit] = await Promise.all([
    db
      .select({
        bucket,
        ckey: sql<string>`lower(btrim(coalesce(${transactions.category}, '')))`,
        // The category as the user actually spells it — the key is lowercased,
        // and printing that back would rename their categories on screen.
        label: sql<string>`max(btrim(coalesce(${transactions.category}, '')))`,
        spent: sql<string>`coalesce(sum(${budgetSpendSignedAmount}), 0)`,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(...budgetSpendPredicates(orgId), gte(transactions.date, first), sql`${transactions.date} < ${last}`))
      .groupBy(bucket, CATEGORY_KEY_SQL),
    db
      .select({ entityId: auditLogs.entityId, action: auditLogs.action, changes: auditLogs.changes, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.entityType, "budget")))
      .orderBy(desc(auditLogs.createdAt)),
  ])

  const historyOf = new Map<string, AmountChange[]>()
  for (const a of audit) {
    const list = historyOf.get(a.entityId) ?? []
    list.push({
      created_at: a.createdAt ? a.createdAt.toISOString() : null,
      action: a.action,
      changes: (a.changes ?? {}) as Record<string, { from: unknown; to: unknown }>,
    })
    historyOf.set(a.entityId, list)
  }

  // A custom-date budget is a one-off sum, not a rhythm: it cannot be bucketed
  // by a recurring window and takes no part here.
  const active = all.filter((r) => r.status === "active" && r.period !== "once")
  const overall = active.find((r) => !r.parent_id && r.categories.length === 0) ?? null
  const lines = active.filter((r) => !r.parent_id && r.categories.length > 0)

  // A category key → the budget that owns it, per level. Disjoint by rule.
  const ownerOf = new Map<string, string>()
  const subOwnerOf = new Map<string, string>()
  for (const r of active) {
    for (const c of r.categories) (r.parent_id ? subOwnerOf : ownerOf).set(categoryKey(c), r.id)
  }

  // The newest scope OR rhythm change among the budgets these figures rest on.
  // Windows that closed before it are folded with settings they did not have —
  // today's categories, and today's period for the converted limit — so they
  // are reported but never judged.
  let scopeStableFrom: string | null = null
  for (const r of [overall, ...lines].filter(Boolean) as SpendingBudgetRecord[]) {
    for (const field of ["categories", "period"] as const) {
      const at = lastChangedAt(historyOf.get(r.id) ?? [], field)
      if (at && (!scopeStableFrom || at > scopeStableFrom)) scopeStableFrom = at
    }
  }

  const capAt = (r: SpendingBudgetRecord, w: BudgetWindow) => {
    const amount = limitAt(historyOf.get(r.id) ?? [], `${w.endExclusive!}T00:00:00.000Z`, r.amount, r.created_at)
    return amount === null ? null : limitForWindow(amount, r.period, view, w)
  }

  const byBucket = new Map<string, { ckey: string; label: string; spent: number }[]>()
  for (const r of rows) {
    const list = byBucket.get(r.bucket) ?? []
    list.push({ ckey: r.ckey, label: r.label ?? "", spent: money(Number(r.spent)) })
    byBucket.set(r.bucket, list)
  }

  const currentStart = windows[windows.length - 1].start!
  const out: BudgetAnalyticsWindow[] = windows.map((w) => {
    const list = byBucket.get(w.start!) ?? []
    const per_budget: Record<string, number> = {}
    let total = 0
    let unclaimed = 0
    for (const { ckey, spent } of list) {
      total += spent
      const top = ownerOf.get(ckey)
      if (top) per_budget[top] = money((per_budget[top] ?? 0) + spent)
      else unclaimed += spent
      const sub = subOwnerOf.get(ckey)
      if (sub) per_budget[sub] = money((per_budget[sub] ?? 0) + spent)
    }
    if (overall) per_budget[overall.id] = money(total)
    const per_budget_limit: Record<string, number | null> = {}
    for (const r of lines) per_budget_limit[r.id] = capAt(r, w)
    if (overall) per_budget_limit[overall.id] = capAt(overall, w)
    const budgetedCaps = lines.map((r) => per_budget_limit[r.id]).filter((n): n is number => n !== null)
    return {
      start: w.start!,
      end_exclusive: w.endExclusive!,
      partial: w.start === currentStart,
      reliable: !scopeStableFrom || `${w.endExclusive!}T00:00:00.000Z` >= scopeStableFrom,
      total: money(total),
      unclaimed: money(Math.max(0, unclaimed)),
      overall_limit: overall ? capAt(overall, w) : null,
      budgeted_limit: money(budgetedCaps.reduce((s, n) => s + n, 0)),
      per_budget_limit,
      per_budget,
    }
  })

  // Where the money went in the CURRENT window — including what no budget covers.
  const nameOfKey = new Map<string, string>()
  for (const r of active) for (const c of r.categories) if (!nameOfKey.has(categoryKey(c))) nameOfKey.set(categoryKey(c), c)
  const categories = (byBucket.get(currentStart) ?? [])
    .filter((c) => c.spent !== 0)
    .map((c) => ({ name: c.ckey ? (nameOfKey.get(c.ckey) ?? c.label ?? c.ckey) : "", spent: c.spent, budget_id: ownerOf.get(c.ckey) ?? null }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 12)

  // Adherence over CLOSED, reliable windows that had a cap at all.
  const capOf = (w: BudgetAnalyticsWindow) => (w.overall_limit !== null ? w.overall_limit : w.budgeted_limit)
  const spendOf = (w: BudgetAnalyticsWindow) => (w.overall_limit !== null ? w.total : money(w.total - w.unclaimed))
  const judged = out.filter((w) => !w.partial && w.reliable && capOf(w) > 0)
  let streak = 0
  for (let i = judged.length - 1; i >= 0; i--) {
    if (spendOf(judged[i]) <= capOf(judged[i])) streak++
    else break
  }
  const within = judged.filter((w) => spendOf(w) <= capOf(w)).length
  return {
    view,
    back,
    today,
    windows: out,
    categories,
    adherence: {
      periods: judged.length,
      within,
      rate: judged.length ? Math.round((within / judged.length) * 100) / 100 : 0,
      streak,
      avg_delta: judged.length ? money(judged.reduce((s, w) => s + (spendOf(w) - capOf(w)), 0) / judged.length) : 0,
    },
  }
}

export type RecentTx = SpendingBudgetRecentTx

/** The latest transactions that landed in this budget's current window. */
export async function recentFor(
  orgId: string,
  budget: Pick<SpendingBudgetRecord, "categories">,
  window: BudgetWindow,
  limit = 10,
): Promise<RecentTx[]> {
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      category: transactions.category,
      amount: budgetSpendSignedAmount,
      kind: transactions.kind,
      clientName: clients.name,
      clientIsOwn: clients.isOwn,
      wealthAccountId: transactions.wealthAccountId,
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...budgetSpendPredicates(orgId), windowSql(window), scopeSql(budget.categories)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    description: r.description ?? "",
    category: r.category ?? "",
    amount: money(Number(r.amount)),
    kind: r.kind,
    client_name: r.clientIsOwn ? null : r.clientName,
    wealth_account_id: r.wealthAccountId,
  }))
}

export type BudgetHistoryEntry = SpendingBudgetHistoryEntry

/** The audit trail is the change history — no second table. */
export async function historyFor(orgId: string, budgetId: string, limit = 30): Promise<BudgetHistoryEntry[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.entityType, "budget"), eq(auditLogs.entityId, budgetId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    changes: (r.changes ?? {}) as BudgetHistoryEntry["changes"],
    actor_user_id: r.actorUserId,
    created_at: r.createdAt ? r.createdAt.toISOString() : null,
  }))
}

// ── Input validation ─────────────────────────────────────────────────────────

export type BudgetInput = {
  name?: string
  icon?: string
  amount?: number
  period?: SpendingPeriod
  start_date?: string | null
  end_date?: string | null
  categories?: string[]
  parent_id?: string | null
  status?: SpendingBudgetStatus
}

export type Parsed = { ok: true; value: BudgetInput } | { ok: false; error: string }

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g")
const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim().slice(0, max) : ""

/**
 * Shape-check a create/update body. Field presence is what the client sent;
 * the cross-row rules (parent, siblings, caps) need the DB and live in
 * `checkRelations`.
 */
export function parseBudgetInput(body: unknown, partial: boolean): Parsed {
  const b = (body ?? {}) as Record<string, unknown>
  const out: BudgetInput = {}

  // '' is allowed ONLY for a top-level all-spending budget (it renders as
  // "Personal budget"); the route enforces that with the rest of the row in hand.
  if (b.name !== undefined || !partial) out.name = clean(b.name, MAX_NAME)
  if (b.icon !== undefined) out.icon = clean(b.icon, MAX_ICON).toLowerCase()
  if (b.amount !== undefined || !partial) {
    const amt = Number(b.amount)
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "amount must be a positive number" }
    if (amountExceedsLimit(amt)) return { ok: false, error: "Amount is too large" }
    out.amount = money(amt)
  }
  if (b.period !== undefined) {
    if (!isSpendingPeriod(b.period)) return { ok: false, error: "period must be daily, weekly, monthly, yearly or once" }
    out.period = b.period
  }
  for (const k of ["start_date", "end_date"] as const) {
    if (b[k] === undefined) continue
    if (b[k] === null || b[k] === "") out[k] = null
    else if (isIsoDate(b[k])) out[k] = b[k]
    else return { ok: false, error: `${k} must be YYYY-MM-DD` }
  }
  if (out.start_date && out.end_date && out.end_date < out.start_date) return { ok: false, error: "end_date is before start_date" }
  if (b.categories !== undefined) {
    if (!Array.isArray(b.categories) || b.categories.some((c) => typeof c !== "string")) {
      return { ok: false, error: "categories must be an array of names" }
    }
    const list = normaliseCategories((b.categories as string[]).map((c) => clean(c, MAX_NAME)))
    if (list.length > MAX_CATEGORIES) return { ok: false, error: `at most ${MAX_CATEGORIES} categories` }
    out.categories = list
  }
  if (b.parent_id !== undefined) {
    if (b.parent_id === null || b.parent_id === "") out.parent_id = null
    else if (typeof b.parent_id === "string") out.parent_id = b.parent_id
    else return { ok: false, error: "parent_id must be an id or null" }
  }
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "closed") return { ok: false, error: "status must be active or closed" }
    out.status = b.status
  }
  return { ok: true, value: out }
}

export type RelationCheck = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string; detail?: Record<string, unknown> }

/**
 * The rules that need other rows: a parent must be a live top-level budget of
 * this org; a sub-budget names ≥ 1 category, inside the parent's scope, that no
 * sibling already claims; caps; and a budget with sub-budgets cannot itself
 * become one.
 */
export function checkRelations(
  next: SpendingBudgetRecord,
  all: SpendingBudgetRecord[],
  opts: { creating: boolean },
): RelationCheck {
  const others = all.filter((r) => r.id !== next.id)
  const children = others.filter((r) => r.parent_id === next.id)

  // Only the overall budget may be nameless — that is the migrated v1 row, and
  // the UI calls it "Overall budget".
  if (!next.name && (next.parent_id || next.categories.length)) return { ok: false, status: 400, error: "name_required" }

  if (next.parent_id) {
    const parent = others.find((r) => r.id === next.parent_id)
    if (!parent) return { ok: false, status: 404, error: "parent_not_found" }
    if (parent.parent_id) return { ok: false, status: 400, error: "parent_is_sub_budget" }
    if (children.length) return { ok: false, status: 400, error: "has_sub_budgets" }
    if (!next.categories.length) return { ok: false, status: 400, error: "sub_budget_needs_categories" }
    if (!categoriesWithin(next.categories, parent.categories)) return { ok: false, status: 400, error: "categories_outside_parent" }
    const siblings = others.filter((r) => r.parent_id === parent.id)
    for (const s of siblings) {
      if (s.status !== "active") continue // a closed sub-budget releases its categories
      const clash = categoryOverlap(next.categories, s.categories)
      if (clash.length) return { ok: false, status: 409, error: "category_claimed", detail: { by: s.name, categories: clash } }
    }
    if (opts.creating && siblings.length >= MAX_CHILDREN) return { ok: false, status: 400, error: "too_many_sub_budgets" }
  } else {
    // Only ACTIVE, recurring budgets compete for a scope: closing one releases
    // its categories (that is the point of closing it), and a custom-date
    // budget is a one-off sum, not a claim on a rhythm.
    const tops = others.filter((r) => !r.parent_id && r.status === "active")
    if (next.categories.length === 0) {
      // The OVERALL budget: all spending, one per workspace, the figure every
      // other budget is measured against. A closed one does not hold the slot.
      const existing = tops.find((r) => r.categories.length === 0 && r.status === "active")
      if (existing && next.status === "active") {
        return { ok: false, status: 409, error: "overall_exists", detail: { by: existing.name } }
      }
    } else {
      // Top-level budgets are disjoint too, so "allocated of overall" is a plain
      // sum that means something. The overall budget is skipped: covering
      // everything is its job.
      for (const t of tops) {
        if (t.categories.length === 0) continue
        if (t.period === "once" || next.period === "once") continue
        const clash = categoryOverlap(next.categories, t.categories)
        if (clash.length) return { ok: false, status: 409, error: "category_claimed", detail: { by: t.name, categories: clash } }
      }
    }
    // A parent's scope must still contain every child's.
    for (const c of children) {
      if (!categoriesWithin(c.categories, next.categories)) {
        return { ok: false, status: 400, error: "child_outside_scope", detail: { child: c.name } }
      }
    }
    if (opts.creating && tops.length >= MAX_TOP_LEVEL) return { ok: false, status: 400, error: "too_many_budgets" }
  }
  return { ok: true }
}

/** Postgres 23505 on our sibling-name index, however Drizzle wrapped it. */
export function isSiblingNameClash(err: unknown): boolean {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const o = e as { code?: string; constraint?: string; cause?: unknown; message?: string }
    if (o.code === "23505" || /spending_budgets_sibling_name_unique/.test(o.message ?? "")) return true
    e = o.cause
  }
  return false
}

/** Next free position among siblings. */
export async function nextPosition(orgId: string, parentId: string | null): Promise<number> {
  const [r] = await db
    .select({ max: sql<number>`coalesce(max(${spendingBudgets.position}), -1)::int` })
    .from(spendingBudgets)
    .where(and(eq(spendingBudgets.organizationId, orgId), parentId ? eq(spendingBudgets.parentId, parentId) : isNull(spendingBudgets.parentId)))
  return (r?.max ?? -1) + 1
}
