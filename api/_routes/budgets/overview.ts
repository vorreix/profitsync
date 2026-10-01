import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { budgets, budgetHistory, clients } from "../../../src/lib/db/schema.js"
import { requireAuth, isPersonalAccount } from "../../_lib/auth.js"
import { capCurrency, excludedFor, inCapCurrency, outgoingByClient, spentFor } from "../../_lib/budget-spend.js"
import { convertAmount, currentRate, ensureRatesInto, reportingCurrencyFor } from "../../_lib/fx-rates.js"
import { isBudgetPeriod, todayUtc, type BudgetPeriod } from "../../../src/lib/budget.js"
import { listBudgets, primaryBudget, toV1Period } from "../../_lib/spending-budgets.js"
import { detectCreep, seriesState, type BudgetAction, type HistoryRow } from "../../../src/lib/budget-history.js"

const KEY = (clientId: string | null) => clientId ?? "default"

// GET /api/budgets/overview — the Budgets page list + cross-budget summary. Current
// spend is derived per budget; the creep flag is computed from each budget's history.
// (Full per-period series + adherence live in /api/budgets/detail, lazy per budget.)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { orgId } = ctx
  const personal = isPersonalAccount(ctx)
  const now = new Date()

  // A personal workspace's budget lives in `spending_budgets` now; an old
  // bundle's Budgets page still reads this, so project the primary one.
  if (personal) {
    const primary = primaryBudget(await listBudgets(orgId, todayUtc(now)))
    const items = primary
      ? [{
          key: "default",
          client_id: null,
          client_name: null,
          is_own: false,
          is_default: true,
          period: toV1Period(primary.period),
          amount: primary.amount,
          spent: primary.spent,
          currency: primary.currency,
          excluded_count: primary.excluded_count,
          state: seriesState(primary.spent, primary.amount),
          ratio: primary.amount > 0 ? primary.spent / primary.amount : null,
          creep_flagged: false,
        }]
      : []
    const lite = items[0] ? { key: "default", client_name: null, is_default: true, ratio: items[0].ratio } : null
    return res.json({
      budgets: items,
      account_type: ctx.accountType,
      currency: primary?.currency ?? (await reportingCurrencyFor(orgId)),
      excluded_count: primary?.excluded_count ?? 0,
      aggregate: {
        total_budget: primary?.amount ?? 0,
        total_spent: primary?.spent ?? 0,
        // Partial spend (rows with no rate) under the cap is not "on track" (MC-082).
        on_track: primary && primary.spent <= primary.amount && !primary.excluded_count ? 1 : 0,
        total: primary ? 1 : 0,
        worst: lite,
        best: lite,
      },
    })
  }

  // Every cap is judged in ITS OWN currency (`capCurrency` — the reporting
  // currency when it was set; rows converted at their own date); what could not
  // be converted is counted, never summed raw.
  const reporting = await reportingCurrencyFor(orgId)
  const [rows, clientRows, historyRows] = await Promise.all([
    db.select().from(budgets).where(eq(budgets.organizationId, orgId)),
    db.select({ id: clients.id, name: clients.name, isOwn: clients.isOwn }).from(clients).where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt))),
    db.select().from(budgetHistory).where(eq(budgetHistory.organizationId, orgId)),
    ensureRatesInto(orgId, [reporting]),
  ])
  const currencyByKey = new Map(rows.map((b) => [KEY(b.clientId), capCurrency(b, reporting)]))
  // Only a cap kept from before a reporting change needs more rates (rare).
  await ensureRatesInto(orgId, [...currencyByKey.values()].filter((c) => c !== reporting))
  const byClient = await outgoingByClient(orgId, now, reporting)

  const nameById = new Map(clientRows.map((c) => [c.id, c.name]))
  const ownById = new Map(clientRows.map((c) => [c.id, c.isOwn]))

  // History grouped per budget (key by client id, "default" for the null budget),
  // ascending by created_at, mapped to the pure-lib shape for detectCreep — only
  // the snapshots in the cap's current currency, so creep never compares $ with €.
  const histByKey = new Map<string, HistoryRow[]>()
  for (const h of historyRows) {
    const k = KEY(h.clientId)
    if (!inCapCurrency(h.currencyCode, currencyByKey.get(k) ?? reporting)) continue
    const list = histByKey.get(k) ?? []
    list.push({
      amount: Number(h.amount),
      period: (isBudgetPeriod(h.period) ? h.period : "monthly") as BudgetPeriod,
      action: h.action as BudgetAction,
      createdAt: (h.createdAt ?? new Date(0)).toISOString(),
    })
    histByKey.set(k, list)
  }
  for (const list of histByKey.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const out = rows.map((b) => {
    const period = (isBudgetPeriod(b.period) ? b.period : "monthly") as BudgetPeriod
    const amount = Number(b.amount)
    // Spend: per-client → that client, in the cap's currency; the business
    // default template (null client) → null (no single spend number). A personal
    // workspace returned above.
    const spent = b.clientId ? spentFor(byClient.get(b.clientId), period) : null
    const excluded_count = b.clientId ? excludedFor(byClient.get(b.clientId), period) : 0
    const ratio = spent !== null && amount > 0 ? spent / amount : null
    const creep = detectCreep(histByKey.get(KEY(b.clientId)) ?? [])
    return {
      key: KEY(b.clientId),
      client_id: b.clientId,
      client_name: b.clientId ? nameById.get(b.clientId) ?? null : null,
      is_own: b.clientId ? ownById.get(b.clientId) ?? false : false,
      is_default: !b.clientId, // personal budget OR business default/template
      period,
      amount,
      spent,
      currency: currencyByKey.get(KEY(b.clientId)) ?? reporting,
      excluded_count,
      state: spent !== null ? seriesState(spent, amount) : "none",
      ratio,
      creep_flagged: creep.flagged,
    }
  // Drop budgets whose client was soft-deleted (trashed) — they aren't in nameById.
  }).filter((b) => !b.client_id || nameById.has(b.client_id))

  // Cross-budget aggregate — over budgets that have a real spend number + amount.
  // The totals are a reporting-currency figure: a cap kept in another currency
  // is CONVERTED into it at today's rate for this header (never relabelled —
  // adding a $ cap to ₹ caps as if it were rupees means nothing). A cap with no
  // rate at all is left out of the sum — and its currency is NAMED in
  // `excluded_currencies`, never dropped quietly; its ratio still ranks and
  // counts, a ratio has no currency.
  const tracked = out.filter((b) => b.spent !== null && b.amount > 0)
  const foreign = [...new Set(tracked.map((b) => b.currency))].filter((c) => c !== reporting)
  const rates = new Map(await Promise.all(foreign.map(async (c) => [c, await currentRate(c, reporting).catch(() => null)] as const)))
  const toReporting = (v: number, c: string) => {
    if (c === reporting) return v
    const rate = rates.get(c)
    return rate ? Number(convertAmount(v, rate)) : null
  }
  const summable = tracked.flatMap((b) => {
    const amount = toReporting(b.amount, b.currency)
    const spent = toReporting(b.spent ?? 0, b.currency)
    return amount === null || spent === null ? [] : [{ amount, spent }]
  })
  const totalBudget = summable.reduce((s, b) => s + b.amount, 0)
  const totalSpent = summable.reduce((s, b) => s + b.spent, 0)
  // A cap whose spend left rows out (no rate) is not known to be on track (MC-082).
  const onTrack = tracked.filter((b) => (b.spent ?? 0) <= b.amount && !b.excluded_count).length
  const ranked = [...tracked].filter((b) => b.ratio !== null).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
  const lite = (b: (typeof out)[number]) => ({ key: b.key, client_name: b.client_name, is_default: b.is_default, ratio: b.ratio })

  return res.json({
    budgets: out,
    account_type: ctx.accountType,
    currency: reporting,
    excluded_count: out.reduce((s, b) => s + b.excluded_count, 0),
    aggregate: {
      total_budget: totalBudget,
      total_spent: totalSpent,
      on_track: onTrack,
      total: tracked.length,
      worst: ranked.length ? lite(ranked[0]) : null,
      best: ranked.length ? lite(ranked[ranked.length - 1]) : null,
      excluded_currencies: foreign.filter((c) => !rates.get(c)),
    },
  })
}
