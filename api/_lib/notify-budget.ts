// Budget-exceeded alerting. Called fire-and-forget after an outgoing transaction
// so it never blocks (or fails) the write. Notifies the workspace's editing
// members once per budget window when a client's spend crosses its budget.
import { and, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { budgets, clients } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import { outgoingByClient, spentFor } from "./budget-spend.js"
import { notifyOrgMembers } from "./notifications.js"

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
  if (spent <= Number(budget.amount)) return

  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId))
  // One alert per budget window: dedupe on (client, period, window start).
  const windowKey = periodStart(period, now) ?? "lifetime"
  const dedupeKey = `budget_exceeded:${clientId}:${period}:${windowKey}`

  await notifyOrgMembers(
    orgId,
    {
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
    },
    { roles: ["owner", "admin", "editor"] },
  )
}
