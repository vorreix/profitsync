// Budget alerting (warning at 80%, exceeded past 100%). Called fire-and-forget
// after an outgoing transaction so it never blocks (or fails) the write.
// Notifies the workspace's editing members once per budget window per tier.
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { budgets, clients } from "../../src/lib/db/schema.js"
import { inWindow, periodStart, scopeMatches, todayUtc, type BudgetPeriod, type SpendingPeriod } from "../../src/lib/budget.js"
import { outgoingByClient, spentFor, type PeriodSums } from "./budget-spend.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "./fx-rates.js"
import { notifyOrgMembers } from "./notifications.js"
import { listBudgets } from "./spending-budgets.js"

// Warn when a budget window reaches this share of its cap (before it's blown).
export const BUDGET_WARNING_RATIO = 0.8

/**
 * Which alert (if any) does this spend level trigger? Pure so the committed
 * unit suite can lock the tier boundaries (DB-free).
 */
export function budgetAlertTier(spent: number, amount: number): "budget_exceeded" | "budget_warning" | null {
  if (amount <= 0) return null
  if (spent > amount) return "budget_exceeded"
  if (spent >= amount * BUDGET_WARNING_RATIO) return "budget_warning"
  return null
}

/**
 * "₹1,200.00" — an amount in the budget's currency, for notification copy.
 * Locale-neutral (en) on purpose: the row is rendered for every member, and the
 * client re-formats from `data.spent`/`data.amount`/`data.currency` when it can.
 */
export function formatBudgetMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/** Sum every client's per-window spend into one whole-workspace total. Exported for the DB-free suite. */
export function orgTotals(byClient: Map<string, PeriodSums>): PeriodSums {
  const total: PeriodSums = { daily: 0, weekly: 0, monthly: 0, lifetime: 0 }
  for (const s of byClient.values()) {
    total.daily += s.daily
    total.weekly += s.weekly
    total.monthly += s.monthly
    total.lifetime += s.lifetime
  }
  return total
}

/** Emit one warning/exceeded notification for a budget that has crossed a tier. */
async function emitBudgetAlert(input: {
  orgId: string
  actorUserId: string
  /** Client id for a per-client cap; null for a spending budget. */
  clientId: string | null
  /** Display name: the client's name, or the spending budget's name. */
  name: string
  period: BudgetPeriod | SpendingPeriod
  spent: number
  amount: number
  /** The currency `spent` and `amount` are in — the budget's own. */
  currency: string
  /** The dedupe scope + window: `sb:<budget id>` and its window start for a spending budget. */
  scope: string
  windowKey: string
  link: string
}): Promise<void> {
  const { orgId, actorUserId, clientId, name, period, spent, amount, currency, scope, windowKey, link } = input
  const tier = budgetAlertTier(spent, amount)
  if (!tier) return
  const exceeded = tier === "budget_exceeded"

  // One alert per budget window PER TIER: dedupe on (tier, scope, period, window
  // start). A window can produce one warning and later one exceeded. The scope
  // segment is the client id for a cap, or `sb:<id>` for a spending budget — a
  // namespace a bare uuid can never collide with.
  const dedupeKey = `${tier}:${scope}:${period}:${windowKey}`
  const percent = Math.round((spent / amount) * 100)
  // The figures travel with their currency so every renderer (bell, push, mail)
  // formats them in the BUDGET's currency, never in whatever the viewer's is.
  const spentLabel = formatBudgetMoney(spent, currency)
  const amountLabel = formatBudgetMoney(amount, currency)

  await notifyOrgMembers(
    orgId,
    exceeded
      ? {
          type: "budget_exceeded",
          title: "Budget exceeded",
          body: `${name || "A budget"} has gone over its ${period} budget (${spentLabel} of ${amountLabel}).`,
          data: {
            i18nKey: "types.budget_exceeded.title",
            i18nBodyKey: "types.budget_exceeded.body",
            i18nParams: { name, period, spent: spentLabel, amount: amountLabel, currency },
            currency,
            spent,
            amount,
          },
          link,
          ...(clientId ? { clientId } : {}),
          actorUserId,
          dedupeKey,
        }
      : {
          type: "budget_warning",
          title: "Budget almost used up",
          body: `${name || "A budget"} has used ${percent}% of its ${period} budget (${spentLabel} of ${amountLabel}).`,
          data: {
            i18nKey: "types.budget_warning.title",
            i18nBodyKey: "types.budget_warning.body",
            i18nParams: { name, period, percent, spent: spentLabel, amount: amountLabel, currency },
            currency,
            spent,
            amount,
          },
          link,
          ...(clientId ? { clientId } : {}),
          actorUserId,
          dedupeKey,
        },
    { roles: ["owner", "admin", "editor"] },
  )
}

/**
 * Evaluate everything the given client's spend could have pushed over a
 * threshold, and alert on what crossed one. Two kinds of budget exist:
 *
 *  1. The **per-client cap** (`budgets.client_id = clientId`) — the business
 *     workspace feature. (A business workspace's NULL-client row is a template
 *     for new clients with no single spend figure, so it is never alerted.)
 *  2. The **spending budgets** (`spending_budgets`) the written row can have
 *     moved: those whose scope contains its category and whose window contains
 *     its date. Tiers only fire on the way up, so a row leaving a budget can
 *     never need one — and a workspace with a dozen budgets past 80 % is not
 *     re-notified (and re-deduped) a dozen times on every unrelated expense.
 *     Without `row`, every active budget is evaluated.
 */
export async function notifyIfBudgetExceeded(
  orgId: string,
  clientId: string,
  actorUserId: string,
  row?: { category?: string | null; date?: string | null },
): Promise<void> {
  const now = new Date()
  const today = todayUtc(now)

  // A per-client cap is judged in the workspace's reporting currency; a spending
  // budget in its own (listBudgets resolves that per row).
  const reporting = await reportingCurrencyFor(orgId)
  await ensureRatesForOrg(orgId, reporting).catch(() => undefined)
  const [rows, byClient, spending] = await Promise.all([
    db.select().from(budgets).where(eq(budgets.organizationId, orgId)),
    outgoingByClient(orgId, now, reporting),
    listBudgets(orgId, today),
  ])

  const clientBudget = rows.find((b) => b.clientId === clientId)
  if (clientBudget && Number(clientBudget.amount) > 0) {
    const period = (clientBudget.period ?? "monthly") as BudgetPeriod
    const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId))
    await emitBudgetAlert({
      orgId,
      actorUserId,
      clientId,
      name: client?.name ?? "A client",
      period,
      spent: spentFor(byClient.get(clientId), period),
      amount: Number(clientBudget.amount),
      currency: reporting,
      scope: clientId,
      windowKey: periodStart(period, now) ?? "lifetime",
      link: `/budgets/clients/${clientId}`,
    })
  }

  // A paused, ended or not-yet-started budget reports state "none" and is
  // skipped; a sub-budget alerts on its own, its parent on its own.
  const touched = spending.filter((b) => {
    if (b.state === "none" || b.amount <= 0) return false
    if (!row) return true
    if (row.category !== undefined && !scopeMatches(b.categories, row.category)) return false
    if (row.date && !inWindow({ start: b.window.start, endExclusive: b.window.end_exclusive }, row.date)) return false
    return true
  })
  await Promise.all(
    touched.map((b) =>
      emitBudgetAlert({
        orgId,
        actorUserId,
        clientId: null,
        name: b.name || "Personal budget",
        period: b.period,
        spent: b.spent,
        amount: b.amount,
        currency: b.currency,
        scope: `sb:${b.id}`,
        // The amount is part of the key so a raised (or lowered) limit re-arms
        // the alert once in the same window.
        windowKey: `${b.window.start ?? "all"}:${b.amount}`,
        link: `/budgets/${b.id}`,
      }),
    ),
  )
}
