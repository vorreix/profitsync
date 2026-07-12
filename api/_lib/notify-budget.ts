// Budget alerting (warning at 80%, exceeded past 100%). Called fire-and-forget
// after an outgoing transaction so it never blocks (or fails) the write.
// Notifies the workspace's editing members once per budget window per tier.
import { and, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { budgets, clients } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import { outgoingByClient, spentFor } from "./budget-spend.js"
import { notifyOrgMembers } from "./notifications.js"

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

export async function notifyIfBudgetExceeded(orgId: string, clientId: string, actorUserId: string): Promise<void> {
  // Only client-specific budgets are alerted here (the per-client feature).
  const [budget] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.organizationId, orgId), eq(budgets.clientId, clientId)))
  if (!budget || Number(budget.amount) <= 0) return

  const period = budget.period as BudgetPeriod
  const now = new Date()
  const sums = await outgoingByClient(orgId, now)
  const spent = spentFor(sums.get(clientId), period)
  const amount = Number(budget.amount)
  const tier = budgetAlertTier(spent, amount)
  if (!tier) return
  const exceeded = tier === "budget_exceeded"

  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId))
  // One alert per budget window PER TIER: dedupe on (tier, client, period,
  // window start). A window can produce one warning and later one exceeded.
  const windowKey = periodStart(period, now) ?? "lifetime"
  const dedupeKey = `${tier}:${clientId}:${period}:${windowKey}`
  const percent = Math.round((spent / amount) * 100)

  await notifyOrgMembers(
    orgId,
    exceeded
      ? {
          type: "budget_exceeded",
          title: "Budget exceeded",
          body: `${client?.name ?? "A client"} has gone over its ${period} budget.`,
          data: {
            i18nKey: "types.budget_exceeded.title",
            i18nBodyKey: "types.budget_exceeded.body",
            i18nParams: { name: client?.name ?? "", period },
          },
          link: "/budgets",
          clientId,
          actorUserId,
          dedupeKey,
        }
      : {
          type: "budget_warning",
          title: "Budget almost used up",
          body: `${client?.name ?? "A client"} has used ${percent}% of its ${period} budget.`,
          data: {
            i18nKey: "types.budget_warning.title",
            i18nBodyKey: "types.budget_warning.body",
            i18nParams: { name: client?.name ?? "", period, percent },
          },
          link: "/budgets",
          clientId,
          actorUserId,
          dedupeKey,
        },
    { roles: ["owner", "admin", "editor"] },
  )
}
