import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import {
  budgetEnvelopes,
  budgetEvents,
  budgetExclusions,
  budgetPeriods,
  clients,
  transactions,
  transactionSettlements,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import { canAddSettlement, categoryKey, round2, settlementRollup } from "../../../../src/lib/budget-math.js"
import { loadPlan } from "../../../_lib/budget-engine.js"

/**
 * Provisional refunds (§8.8) and explicit settlement links (§8.8.1).
 *
 * GET  /api/budgets/v2/refunds
 *      The inflows in the open period that currently net against an envelope
 *      only because they share its category — i.e. the guesses the user should
 *      get a chance to confirm or reject.
 *
 * POST /api/budgets/v2/refunds
 *      { action: "reject", transaction_id }
 *        Records a budget_exclusions row ("not a refund"). The transaction is
 *        untouched — Budget v2 owns no column on `transactions`.
 *      { action: "link", expense_transaction_id, settlement_transaction_id, amount?, kind? }
 *        Records a real settlement. PARTIAL links are the point: many rows per
 *        expense, so "400 reimbursed 250 then 150" is expressible.
 *      { action: "unlink", expense_transaction_id, settlement_transaction_id }
 *
 * A linked settlement stops being counted as a provisional guess (the engine
 * excludes linked inflows), so confirming one can never double-count the money.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  // ── the provisional list ──────────────────────────────────────────────────
  if (req.method === "GET") {
    const [open] = await db
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
      .orderBy(desc(budgetPeriods.start))
      .limit(1)
    if (!open) return res.json({ refunds: [] })

    // Only categories an EXPLICIT envelope claims can net. The catch-all never
    // nets an inflow, because netting salary against "everything else" would be
    // worse than not netting at all (§8.8).
    const envelopes = await db
      .select({ id: budgetEnvelopes.id, name: budgetEnvelopes.name, matchKeys: budgetEnvelopes.matchKeys })
      .from(budgetEnvelopes)
      .where(
        and(
          eq(budgetEnvelopes.planId, plan.id),
          eq(budgetEnvelopes.section, "flexible"),
          eq(budgetEnvelopes.isCatchAll, false),
          eq(budgetEnvelopes.status, "active"),
        ),
      )
    const byKey = new Map<string, { id: string; name: string }>()
    for (const e of envelopes) {
      for (const k of ((e.matchKeys as string[] | null) ?? []).map(categoryKey)) {
        if (k) byKey.set(k, { id: e.id, name: e.name })
      }
    }
    if (!byKey.size) return res.json({ refunds: [] })

    const keys = [...byKey.keys()]
    const rows = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        category: transactions.category,
        description: transactions.description,
        key: sql<string>`lower(btrim(coalesce(${transactions.category}, '')))`,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(
        and(
          eq(clients.organizationId, orgId),
          isNull(clients.deletedAt),
          isNull(transactions.deletedAt),
          eq(transactions.type, "incoming"),
          eq(transactions.kind, "standard"),
          eq(transactions.isSystem, false),
          gte(transactions.date, open.start),
          lt(transactions.date, open.endExclusive),
          sql`lower(btrim(coalesce(${transactions.category}, ''))) in (${sql.join(
            keys.map((k) => sql`${k}`),
            sql`, `,
          )})`,
          // Already excluded ("not a refund") or already linked — neither is a
          // pending guess any more.
          sql`not exists (select 1 from ${budgetExclusions} bx where bx.transaction_id = ${transactions.id} and bx.plan_id = ${plan.id})`,
          sql`not exists (select 1 from ${transactionSettlements} ts where ts.settlement_transaction_id = ${transactions.id})`,
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(100)

    return res.json({
      period: { start: open.start, end_exclusive: open.endExclusive },
      refunds: rows.map((r) => ({
        transaction_id: r.id,
        date: r.date,
        amount: round2(Number(r.amount)),
        category: r.category,
        description: r.description,
        envelope: byKey.get(r.key ?? "") ?? null,
      })),
    })
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const body = req.body as {
    action?: string
    transaction_id?: string
    expense_transaction_id?: string
    settlement_transaction_id?: string
    amount?: number
    kind?: string
  }
  const action = String(body.action ?? "")

  /** Org-scoped transaction lookup — an id from another workspace must 404. */
  const findTx = async (id: string) => {
    const [row] = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        type: transactions.type,
        date: transactions.date,
        category: transactions.category,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNull(transactions.deletedAt)))
    return row ?? null
  }

  // ── "not a refund" ────────────────────────────────────────────────────────
  if (action === "reject") {
    const txId = String(body.transaction_id ?? "")
    if (!txId) return res.status(400).json({ error: "transaction_id is required" })
    const tx = await findTx(txId)
    if (!tx) return res.status(404).json({ error: "Transaction not found" })

    await db
      .insert(budgetExclusions)
      .values({ organizationId: orgId, planId: plan.id, transactionId: tx.id, reason: "not_a_refund", excludedBy: userId })
      .onConflictDoNothing()

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      action: "refund_rejected",
      amount: tx.amount,
      detail: { transaction_id: tx.id, category: tx.category, date: tx.date },
      actorUserId: userId,
    })

    return res.json({ excluded: true, transaction_id: tx.id })
  }

  // ── link / unlink an explicit settlement ──────────────────────────────────
  if (action === "link" || action === "unlink") {
    const expenseId = String(body.expense_transaction_id ?? "")
    const settlementId = String(body.settlement_transaction_id ?? "")
    if (!expenseId || !settlementId) {
      return res.status(400).json({ error: "expense_transaction_id and settlement_transaction_id are required" })
    }
    if (expenseId === settlementId) return res.status(400).json({ error: "A transaction cannot settle itself" })

    if (action === "unlink") {
      const [removed] = await db
        .delete(transactionSettlements)
        .where(
          and(
            eq(transactionSettlements.organizationId, orgId),
            eq(transactionSettlements.expenseTransactionId, expenseId),
            eq(transactionSettlements.settlementTransactionId, settlementId),
          ),
        )
        .returning()
      if (!removed) return res.status(404).json({ error: "Link not found" })

      await db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        action: "settlement_unlinked",
        amount: removed.amount,
        detail: { expense_transaction_id: expenseId, settlement_transaction_id: settlementId },
        actorUserId: userId,
      })
      return res.json({ unlinked: true })
    }

    const [expense, settlement] = await Promise.all([findTx(expenseId), findTx(settlementId)])
    if (!expense || !settlement) return res.status(404).json({ error: "Transaction not found" })
    if (expense.type !== "outgoing") return res.status(400).json({ error: "The expense must be an outflow" })
    if (settlement.type !== "incoming") return res.status(400).json({ error: "The settlement must be an inflow" })

    const kind = ["refund", "reimbursement", "chargeback"].includes(String(body.kind)) ? String(body.kind) : "refund"

    // Σ settlements ≤ expense.amount, enforced HERE because a CHECK cannot
    // express a cross-row aggregate. Re-read inside the request so two
    // concurrent links cannot both see the old sum.
    const priorRows = await db
      .select({ amount: transactionSettlements.amount })
      .from(transactionSettlements)
      .where(
        and(
          eq(transactionSettlements.organizationId, orgId),
          eq(transactionSettlements.expenseTransactionId, expenseId),
        ),
      )
    const prior = priorRows.map((r) => round2(Number(r.amount)))
    const expenseAmount = round2(Number(expense.amount))
    const requested = body.amount == null ? round2(Number(settlement.amount)) : round2(Number(body.amount))
    if (amountExceedsLimit(requested)) return res.status(400).json({ error: "Amount is too large" })

    const check = canAddSettlement({
      expenseAmount,
      alreadySettled: prior.reduce((a, b) => a + b, 0),
      amount: requested,
    })
    if (!check.ok) {
      return res.status(check.reason === "exceeds_expense" ? 409 : 400).json({
        error: check.reason,
        message:
          check.reason === "exceeds_expense"
            ? check.room > 0
              ? `Only ${check.room} of this expense is still outstanding`
              : "This expense is already fully settled"
            : undefined,
        room: check.room,
      })
    }

    let linked
    try {
      ;[linked] = await db
        .insert(transactionSettlements)
        .values({
          organizationId: orgId,
          expenseTransactionId: expenseId,
          settlementTransactionId: settlementId,
          amount: String(check.amount),
          kind,
          createdBy: userId,
        })
        .returning()
    } catch (err) {
      if (violates(err, "transaction_settlements_pair_unique")) {
        return res.status(409).json({ error: "already_linked" })
      }
      throw err
    }

    const rollup = settlementRollup(expenseAmount, [...prior, check.amount])

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      action: "settlement_linked",
      amount: String(check.amount),
      detail: {
        expense_transaction_id: expenseId,
        settlement_transaction_id: settlementId,
        kind,
        settled: rollup.settled,
        outstanding: rollup.outstanding,
        status: rollup.status,
      },
      actorUserId: userId,
    })

    return res.status(201).json({ settlement: serialize(linked), rollup })
  }

  return res.status(400).json({ error: "action must be reject, link or unlink" })
}

/**
 * Did this error violate the named constraint?
 *
 * A NeonDbError puts the constraint in `.constraint` and the offending row in
 * `.detail`; the `.message` is often just "duplicate key value violates unique
 * constraint" with the name quoted, and for a UNIQUE INDEX (as opposed to a
 * table constraint) `.constraint` can be absent entirely. Checking all three is
 * what makes the difference between a helpful 409 and a bare 500.
 */
function violates(err: unknown, constraint: string): boolean {
  // Drizzle wraps the driver error in a DrizzleQueryError whose `message` is the
  // SQL text, so the constraint name lives on `.cause` (the NeonDbError). Walk
  // the chain rather than inspecting only the outer error, which is what made
  // every unique violation surface as a 500 instead of a helpful 409.
  let node: unknown = err
  for (let depth = 0; node && typeof node === "object" && depth < 5; depth++) {
    const e = node as { constraint?: unknown; detail?: unknown; message?: unknown; cause?: unknown }
    if (typeof e.constraint === "string" && e.constraint === constraint) return true
    if ([e.message, e.detail].some((v) => typeof v === "string" && v.includes(constraint))) return true
    node = e.cause
  }
  return false
}
