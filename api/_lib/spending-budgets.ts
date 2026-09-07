import { and, asc, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { auditLogs, clients, spendingBudgets, transactions } from "../../src/lib/db/schema.js"
import {
  budgetState,
  budgetWindow,
  categoriesWithin,
  categoryKey,
  categoryOverlap,
  daysLeft,
  isIsoDate,
  isSpendingPeriod,
  normaliseCategories,
  perDayLeft,
  windowPhase,
  type BudgetWindow,
  type SpendingPeriod,
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
  "window" | "spent" | "remaining" | "ratio" | "state" | "per_day_left" | "other_spent" | "children_count"
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
    status: row.status === "paused" ? "paused" : "active",
  }
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

/**
 * Attach the live figures to a set of records for `today`. `all` must contain
 * every record of the org (children included) so a parent's remainder — spend
 * in its scope that no ACTIVE sub-budget claims — can be summed in the same
 * statement, as a real filter rather than a subtraction (two sub-budgets that
 * came to share a category through a rename would otherwise push it negative).
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
  const windows = new Map<string, BudgetWindow>()
  for (const r of records) {
    const window = budgetWindow(r.period, r, today)
    windows.set(r.id, window)
    items.push({ key: r.id, window, categories: r.categories })
    const active = (childrenOf.get(r.id) ?? []).filter((c) => c.status === "active")
    if (active.length) {
      items.push({ key: `rest:${r.id}`, window, categories: r.categories, exclude: active.flatMap((c) => c.categories) })
    }
  }
  const spent = await spendByItem(orgId, items)

  return records.map((r) => {
    const w = windows.get(r.id)!
    const s = spent.get(r.id) ?? 0
    const phase = windowPhase(w, today)
    const days = daysLeft(w, today)
    const { ratio, remaining, state } = budgetState(s, r.amount)
    const kids = childrenOf.get(r.id) ?? []
    const counted = r.status === "active" && r.amount > 0 && phase === "active"
    return {
      ...r,
      window: { start: w.start, end_exclusive: w.endExclusive, phase, days_left: days },
      spent: s,
      remaining: money(remaining),
      ratio: r.amount > 0 && Number.isFinite(ratio) ? Math.round(ratio * 10_000) / 10_000 : null,
      state: counted ? state : "none",
      per_day_left: counted ? perDayLeft(remaining, days) : null,
      other_spent: kids.some((k) => k.status === "active") ? (spent.get(`rest:${r.id}`) ?? 0) : null,
      children_count: kids.length,
    }
  })
}

export async function listBudgets(orgId: string, today: string): Promise<SpendingBudgetView[]> {
  const all = await loadRecords(orgId)
  return withSpend(orgId, all, today, all)
}

export type SectionSummary = {
  /** Distinct ledger rows in the UNION of the section's active top-level scopes — never a sum of rows. */
  spent: number
  /** Σ limits, only when no two scopes overlap (then it IS a cap); null otherwise. */
  limit: number | null
  overlapping: boolean
  count: number
  on_track: number
}

/**
 * The header figure for each PERIODIC section of the list. Summing the rows
 * would count a grocery receipt twice when "All spending" and "Groceries" both
 * exist, so the section's spend is one more filter column over the UNION of
 * its scopes; its limit is quoted only when the scopes are pairwise disjoint,
 * because "All spending €1000 + Groceries €200" is a €1000 cap, not €1200.
 * `once` budgets have their own windows and get no header money at all.
 */
export async function sectionSummaries(
  orgId: string,
  budgets: SpendingBudgetView[],
  today: string,
): Promise<Partial<Record<SpendingPeriod, SectionSummary>>> {
  const periodic = (["daily", "weekly", "monthly", "yearly"] as const).filter((p) =>
    budgets.some((b) => b.period === p && !b.parent_id),
  )
  const items: SpendItem[] = []
  const meta = new Map<SpendingPeriod, { overlapping: boolean; limit: number; count: number; on_track: number }>()
  for (const period of periodic) {
    const tops = budgets.filter((b) => b.period === period && !b.parent_id)
    const counted = tops.filter((b) => b.state !== "none")
    const scopes = counted.map((b) => b.categories)
    const allSpending = scopes.some((c) => c.length === 0)
    let overlapping = allSpending && scopes.length > 1
    for (let i = 0; i < scopes.length && !overlapping; i++) {
      for (let j = i + 1; j < scopes.length; j++) {
        if (categoryOverlap(scopes[i], scopes[j]).length) { overlapping = true; break }
      }
    }
    meta.set(period, {
      overlapping,
      limit: counted.reduce((s, b) => s + b.amount, 0),
      count: tops.length,
      on_track: counted.filter((b) => b.spent <= b.amount).length,
    })
    if (counted.length) {
      items.push({ key: period, window: budgetWindow(period, null, today), categories: allSpending ? [] : scopes.flat() })
    }
  }
  const spent = await spendByItem(orgId, items)
  const out: Partial<Record<SpendingPeriod, SectionSummary>> = {}
  for (const [period, m] of meta) {
    out[period] = { spent: spent.get(period) ?? 0, limit: m.overlapping ? null : money(m.limit), overlapping: m.overlapping, count: m.count, on_track: m.on_track }
  }
  return out
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
  const parents = new Set(all.filter((r) => r.parent_id).map((r) => r.parent_id!))
  for (const parentId of parents) {
    const kids = all.filter((r) => r.parent_id === parentId)
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const clash = categoryOverlap(next.get(kids[i].id)!, next.get(kids[j].id)!)
        if (clash.length) return { updates, clash: { a: kids[i].name, b: kids[j].name, categories: clash } }
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
  const bucket = sql<string>`to_char(date_trunc(${unit}, ${transactions.date}::timestamp), 'YYYY-MM-DD')`
  const rows = await db
    .select({ start: bucket, spent: sql<string>`coalesce(sum(${budgetSpendSignedAmount}), 0)` })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...budgetSpendPredicates(orgId), sql`${transactions.date} >= ${first}`, sql`${transactions.date} < ${last}`, scopeSql(budget.categories)))
    .groupBy(bucket)
  const byStart = new Map(rows.map((r) => [r.start, money(Number(r.spent))]))
  return windows.map((w) => ({ start: w.start!, spent: byStart.get(w.start!) ?? 0 }))
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
    if (b.status !== "active" && b.status !== "paused") return { ok: false, error: "status must be active or paused" }
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
      const clash = categoryOverlap(next.categories, s.categories)
      if (clash.length) return { ok: false, status: 409, error: "category_claimed", detail: { by: s.name, categories: clash } }
    }
    if (opts.creating && siblings.length >= MAX_CHILDREN) return { ok: false, status: 400, error: "too_many_sub_budgets" }
  } else {
    // A parent's scope must still contain every child's.
    for (const c of children) {
      if (!categoriesWithin(c.categories, next.categories)) {
        return { ok: false, status: 400, error: "child_outside_scope", detail: { child: c.name } }
      }
    }
    if (opts.creating && others.filter((r) => !r.parent_id).length >= MAX_TOP_LEVEL) return { ok: false, status: 400, error: "too_many_budgets" }
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
