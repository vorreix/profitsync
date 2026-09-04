import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm"
import { db, dbBatch, serialize } from "../../../../src/lib/db/index.js"
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
import { violates } from "../../../_lib/db-errors.js"
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

  /**
   * Org-scoped transaction lookup — an id from another workspace must 404.
   * Only rows the engine counts as spend/inflow may settle or be settled
   * (§8.3): a transfer leg, an is_system balance entry or a row on a trashed
   * client is neither — the same inclusion predicates as the GET above and the
   * engine's own spend queries, so a link can never net against money the
   * plan never counted.
   */
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
      .where(
        and(
          eq(transactions.id, id),
          eq(clients.organizationId, orgId),
          isNull(clients.deletedAt),
          isNull(transactions.deletedAt),
          eq(transactions.kind, "standard"),
          eq(transactions.isSystem, false),
        ),
      )
    return row ?? null
  }

  // ── "not a refund" ────────────────────────────────────────────────────────
  if (action === "reject") {
    const txId = String(body.transaction_id ?? "")
    if (!txId) return res.status(400).json({ error: "transaction_id is required" })
    const tx = await findTx(txId)
    if (!tx) return res.status(404).json({ error: "Transaction not found" })
    // Only an INFLOW can be a provisional refund. An exclusion row drops the
    // transaction from spend and restatement regardless of its reason, so
    // accepting an outflow here would silently erase an expense from the plan.
    if (tx.type !== "incoming") return res.status(400).json({ error: "Only an inflow can be marked as not a refund" })

    const excluded = await db
      .insert(budgetExclusions)
      .values({ organizationId: orgId, planId: plan.id, transactionId: tx.id, reason: "not_a_refund", excludedBy: userId })
      .onConflictDoNothing()
      .returning({ id: budgetExclusions.id })
    // Already excluded: keep the audit log honest — no second refund_rejected event.
    if (!excluded.length) return res.json({ excluded: true, transaction_id: tx.id, already: true })

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

    // Two caps, both enforced HERE because a CHECK cannot express a cross-row
    // aggregate: Σ settlements ≤ expense.amount (invariant 7), and Σ links drawn
    // from one inflow ≤ that inflow (§8.8.1 — a €50 refund cannot settle €400,
    // and one inflow cannot settle several expenses for its full amount each).
    const sums = async () => {
      const [priorRows, inflowRows] = await Promise.all([
        db
          .select({ amount: transactionSettlements.amount })
          .from(transactionSettlements)
          .where(and(eq(transactionSettlements.organizationId, orgId), eq(transactionSettlements.expenseTransactionId, expenseId))),
        db
          .select({ amount: transactionSettlements.amount })
          .from(transactionSettlements)
          .where(and(eq(transactionSettlements.organizationId, orgId), eq(transactionSettlements.settlementTransactionId, settlementId))),
      ])
      return {
        prior: priorRows.map((r) => round2(Number(r.amount))),
        inflowLinked: inflowRows.reduce((a, r) => a + round2(Number(r.amount)), 0),
      }
    }
    const { prior, inflowLinked } = await sums()
    const expenseAmount = round2(Number(expense.amount))
    const inflowAmount = round2(Number(settlement.amount))
    const requested = body.amount == null ? inflowAmount : round2(Number(body.amount))
    if (amountExceedsLimit(requested)) return res.status(400).json({ error: "Amount is too large" })

    const refuse = (check: Exclude<ReturnType<typeof canAddSettlement>, { ok: true }>) =>
      res.status(check.reason === "not_positive" ? 400 : 409).json({
        error: check.reason,
        message:
          check.reason === "exceeds_expense"
            ? check.room > 0
              ? `Only ${check.room} of this expense is still outstanding`
              : "This expense is already fully settled"
            : check.reason === "exceeds_settlement"
              ? check.room > 0
                ? `Only ${check.room} of this refund is still unallocated`
                : "This refund is already fully linked"
              : undefined,
        room: check.room,
      })

    const check = canAddSettlement({
      expenseAmount,
      alreadySettled: prior.reduce((a, b) => a + b, 0),
      amount: requested,
      inflowAmount,
      inflowAlreadyLinked: inflowLinked,
    })
    if (!check.ok) return refuse(check)

    // The guard is made RACE-SAFE in one batch (one transaction): lock the
    // expense row, then insert only if both caps still hold against the sums
    // as they stand once the lock is held. Two concurrent links of different
    // inflows against one expense can therefore never both pass; the loser
    // inserts nothing and is told the real room.
    let inserted: Record<string, unknown>[] = []
    try {
      const results = await dbBatch([
        db.execute(sql`select id from ${transactions} where id = ${expenseId} for update`),
        db.execute(sql`
          insert into ${transactionSettlements}
            (organization_id, expense_transaction_id, settlement_transaction_id, amount, kind, created_by)
          select ${orgId}, ${expenseId}, ${settlementId}, ${String(check.amount)}::numeric, ${kind}, ${userId}
           where coalesce((select sum(amount) from ${transactionSettlements} where expense_transaction_id = ${expenseId}), 0)
                   + ${String(check.amount)}::numeric <= ${String(expenseAmount)}::numeric
             and coalesce((select sum(amount) from ${transactionSettlements} where settlement_transaction_id = ${settlementId}), 0)
                   + ${String(check.amount)}::numeric <= ${String(inflowAmount)}::numeric
          returning *
        `),
      ] as unknown as Parameters<typeof dbBatch>[0])
      inserted = ((results[1] as unknown as { rows?: Record<string, unknown>[] })?.rows ?? []) as Record<string, unknown>[]
    } catch (err) {
      if (violates(err, "transaction_settlements_pair_unique")) {
        return res.status(409).json({ error: "already_linked" })
      }
      throw err
    }
    if (!inserted.length) {
      // Lost the race: report the room as it stands now.
      const now = await sums()
      const again = canAddSettlement({
        expenseAmount,
        alreadySettled: now.prior.reduce((a, b) => a + b, 0),
        amount: requested,
        inflowAmount,
        inflowAlreadyLinked: now.inflowLinked,
      })
      return refuse(again.ok ? { ok: false, reason: "exceeds_expense", room: 0 } : again)
    }
    const linked = inserted[0]

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
