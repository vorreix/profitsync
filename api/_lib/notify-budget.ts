// Budget alerting (warning at 80%, exceeded past 100%). Called fire-and-forget
// after an outgoing transaction so it never blocks (or fails) the write.
// Notifies the workspace's editing members once per budget window per tier.
import { and, eq, ne } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { budgets, clients, organizations, budgetPlans } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import { outgoingByClient, spentFor, type PeriodSums } from "./budget-spend.js"
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
  /** Client id for a per-client budget; null for the org-level (personal) budget. */
  clientId: string | null
  /** Display name: the client's name, or the workspace name for the personal budget. */
  name: string
  period: BudgetPeriod
  spent: number
  amount: number
  now: Date
}): Promise<void> {
  const { orgId, actorUserId, clientId, name, period, spent, amount, now } = input
  const tier = budgetAlertTier(spent, amount)
  if (!tier) return
  const exceeded = tier === "budget_exceeded"

  // One alert per budget window PER TIER: dedupe on (tier, scope, period, window
  // start). A window can produce one warning and later one exceeded. The scope
  // segment is the client id, or the literal "org" for the org-level budget —
  // a namespace a uuid can never collide with.
  const windowKey = periodStart(period, now) ?? "lifetime"
  const dedupeKey = `${tier}:${clientId ?? "org"}:${period}:${windowKey}`
  const percent = Math.round((spent / amount) * 100)

  await notifyOrgMembers(
    orgId,
    exceeded
      ? {
          type: "budget_exceeded",
          title: "Budget exceeded",
          body: `${name || "A budget"} has gone over its ${period} budget.`,
          data: {
            i18nKey: "types.budget_exceeded.title",
            i18nBodyKey: "types.budget_exceeded.body",
            i18nParams: { name, period },
          },
          link: "/budgets",
          ...(clientId ? { clientId } : {}),
          actorUserId,
          dedupeKey,
        }
      : {
          type: "budget_warning",
          title: "Budget almost used up",
          body: `${name || "A budget"} has used ${percent}% of its ${period} budget.`,
          data: {
            i18nKey: "types.budget_warning.title",
            i18nBodyKey: "types.budget_warning.body",
            i18nParams: { name, period, percent },
          },
          link: "/budgets",
          ...(clientId ? { clientId } : {}),
          actorUserId,
          dedupeKey,
        },
    { roles: ["owner", "admin", "editor"] },
  )
}

/**
 * Evaluate every budget that the given client's spend could have pushed over a
 * threshold, and alert on those that crossed one.
 *
 * Two scopes are checked, because a single expense can breach both:
 *
 *  1. The **per-client** budget (`client_id = clientId`).
 *  2. The **org-level** budget (`client_id IS NULL`) — but only on a PERSONAL
 *     workspace, where it is the user's one real budget and its spend is the
 *     whole workspace's outgoing. On a business workspace the same row is a
 *     *template* for new clients with no single spend figure (exactly as
 *     `GET /api/budgets` reports `spent: null`), so alerting on it would be
 *     meaningless.
 *
 * Scope 2 was previously unreachable — the query filtered `client_id = clientId`,
 * which a NULL row can never match — so a personal workspace's only budget never
 * alerted. That gap was documented in docs/notifications/PLAN.md.
 */
export async function notifyIfBudgetExceeded(orgId: string, clientId: string, actorUserId: string): Promise<void> {
  const now = new Date()

  const [rows, byClient, orgRow] = await Promise.all([
    // Every budget for the org in one round trip, then both scopes are picked out
    // in memory. An org has at most one budget per client plus one org-level row,
    // so this set is bounded by the client quota — cheaper than two queries.
    db.select().from(budgets).where(eq(budgets.organizationId, orgId)),
    outgoingByClient(orgId, now),
    db
      .select({ name: organizations.name, accountType: organizations.accountType })
      .from(organizations)
      .where(eq(organizations.id, orgId)),
  ])

  const clientBudget = rows.find((b) => b.clientId === clientId)
  const orgBudget = rows.find((b) => b.clientId === null)
  const isPersonal = orgRow[0]?.accountType === "personal"

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
      now,
    })
  }

  // A personal workspace with a Budget v2 plan is alerted by the v2 emitter
  // (notify-budget-v2.ts); its v1 row is frozen at migration time and must not
  // keep firing "over budget" from a figure the user no longer edits.
  const [v2Plan] = isPersonal
    ? await db
        .select({ id: budgetPlans.id })
        .from(budgetPlans)
        .where(and(eq(budgetPlans.organizationId, orgId), ne(budgetPlans.status, "archived")))
        .limit(1)
    : []
  if (isPersonal && !v2Plan && orgBudget && Number(orgBudget.amount) > 0) {
    const period = (orgBudget.period ?? "monthly") as BudgetPeriod
    await emitBudgetAlert({
      orgId,
      actorUserId,
      clientId: null,
      name: orgRow[0]?.name ?? "Your budget",
      period,
      spent: orgTotals(byClient)[period],
      amount: Number(orgBudget.amount),
      now,
    })
  }
}
