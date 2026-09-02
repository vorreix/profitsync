import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm"
import { db, serialize } from "../../../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetCommitments,
  budgetEnvelopes,
  budgetEvents,
  budgetPeriods,
  budgetPeriodSnapshots,
  clients,
  transactions,
  transactionSettlements,
} from "../../../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../../../_lib/auth.js"
import {
  categoryKey,
  remaining,
  round2,
  settlementRollup,
  state,
} from "../../../../../../src/lib/budget-math.js"
import { loadPlan, planToday } from "../../../../../_lib/budget-engine.js"

/**
 * GET /api/budgets/v2/envelopes/:id/detail
 *
 * One envelope, in depth: this period's figures, the transactions behind them,
 * its history across closed periods, its commitments, and its audit trail.
 *
 * This is the answer to "why is this number what it is" (§6.9). A budget that
 * shows a total but cannot show the rows behind it is not auditable, which was
 * v1's defect #14.
 *
 * READ-ONLY — like every budget GET.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { orgId } = ctx

  const id = String(req.query.id ?? "")
  if (!id) return res.status(400).json({ error: "Missing id" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  const [envelope] = await db
    .select()
    .from(budgetEnvelopes)
    .where(
      and(eq(budgetEnvelopes.id, id), eq(budgetEnvelopes.planId, plan.id), eq(budgetEnvelopes.organizationId, orgId)),
    )
  if (!envelope) return res.status(404).json({ error: "Envelope not found" })

  const today = planToday(plan)
  const num = (v: unknown) => (v == null ? 0 : Number(v))

  const [open] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(desc(budgetPeriods.start))
    .limit(1)

  // ── history: this envelope across closed periods ──────────────────────────
  //
  // A closed period's figures come from its SNAPSHOT, never from a recompute:
  // that is what makes history reproducible (§8.11), and it is why a snapshot
  // stores the envelope name too — a later rename must not change what a closed
  // period says. The allocation supplies only what the user authored.
  const historyRows = await db
    .select({
      period: budgetPeriods,
      allocation: budgetAllocations,
      snapshot: budgetPeriodSnapshots.payload,
      snapshotVersion: budgetPeriodSnapshots.version,
      restatedReason: budgetPeriodSnapshots.restatedReason,
    })
    .from(budgetAllocations)
    .innerJoin(budgetPeriods, eq(budgetAllocations.periodId, budgetPeriods.id))
    .leftJoin(
      budgetPeriodSnapshots,
      and(eq(budgetPeriodSnapshots.periodId, budgetPeriods.id), eq(budgetPeriodSnapshots.isCurrent, true)),
    )
    .where(and(eq(budgetAllocations.envelopeId, envelope.id), eq(budgetPeriods.planId, plan.id)))
    .orderBy(desc(budgetPeriods.start))
    .limit(24)

  /** This envelope's line out of a closed period's snapshot payload. */
  const snapshotLine = (payload: unknown): Record<string, unknown> | null => {
    if (!payload || typeof payload !== "object") return null
    const list = (payload as { envelopes?: unknown }).envelopes
    if (!Array.isArray(list)) return null
    return (
      (list.find((e) => (e as Record<string, unknown>)?.envelope_id === envelope.id) as
        | Record<string, unknown>
        | undefined) ?? null
    )
  }

  // ── the rows behind this period's spend ───────────────────────────────────
  const keys = ((envelope.matchKeys as string[] | null) ?? []).map(categoryKey).filter(Boolean)
  let txRows: Record<string, unknown>[] = []
  let settlementRows: Record<string, unknown>[] = []

  if (open && envelope.section === "flexible") {
    // The catch-all claims whatever no explicit envelope does, so its row list
    // is defined by exclusion — the same rule the totals use, so the list and
    // the total can never disagree.
    let scope
    if (envelope.isCatchAll) {
      const others = await db
        .select({ matchKeys: budgetEnvelopes.matchKeys })
        .from(budgetEnvelopes)
        .where(
          and(
            eq(budgetEnvelopes.planId, plan.id),
            eq(budgetEnvelopes.isCatchAll, false),
            sql`${budgetEnvelopes.status} <> 'removed'`,
          ),
        )
      const claimed = [
        ...new Set(others.flatMap((o) => ((o.matchKeys as string[] | null) ?? []).map(categoryKey)).filter(Boolean)),
      ]
      scope = claimed.length
        ? sql`lower(btrim(coalesce(${transactions.category}, ''))) not in (${sql.join(
            claimed.map((k) => sql`${k}`),
            sql`, `,
          )})`
        : sql`true`
    } else if (keys.length) {
      scope = sql`lower(btrim(coalesce(${transactions.category}, ''))) in (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )})`
    } else {
      // An explicit envelope with no categories yet matches nothing, and must
      // not fall through to matching everything.
      scope = sql`false`
    }

    const rows = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        type: transactions.type,
        category: transactions.category,
        description: transactions.description,
        client_id: transactions.clientId,
        settled: sql<string>`coalesce((
          select sum(ts.amount::numeric) from ${transactionSettlements} ts
          where ts.expense_transaction_id = ${transactions.id}
        ), 0)`,
        is_settlement: sql<boolean>`exists (
          select 1 from ${transactionSettlements} ts where ts.settlement_transaction_id = ${transactions.id}
        )`,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(
        and(
          eq(clients.organizationId, orgId),
          isNull(clients.deletedAt),
          isNull(transactions.deletedAt),
          eq(transactions.kind, "standard"),
          eq(transactions.isSystem, false),
          gte(transactions.date, open.start),
          lt(transactions.date, open.endExclusive),
          scope,
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(200)

    txRows = rows.map((r) => {
      const amount = round2(Number(r.amount))
      const rollup = r.type === "outgoing" ? settlementRollup(amount, [round2(Number(r.settled))]) : null
      return {
        id: r.id,
        date: r.date,
        amount,
        type: r.type,
        category: r.category,
        description: r.description,
        client_id: r.client_id,
        // "This €400 was reimbursed €250, €150 still outstanding" — the whole
        // reason an explicit settlement table exists.
        settlement_status: rollup?.status ?? null,
        settled_amount: rollup?.settled ?? null,
        outstanding: rollup?.outstanding ?? null,
        // An inflow that has been LINKED is a confirmed settlement, not a
        // provisional guess; the UI must not offer to confirm it again.
        is_confirmed_settlement: r.type === "incoming" ? Boolean(r.is_settlement) : false,
      }
    })

    const ids = rows.map((r) => r.id)
    if (ids.length) {
      const links = await db
        .select()
        .from(transactionSettlements)
        .where(
          and(
            eq(transactionSettlements.organizationId, orgId),
            inArray(transactionSettlements.expenseTransactionId, ids),
          ),
        )
      settlementRows = links.map(serialize)
    }
  }

  // ── commitments living in this envelope ───────────────────────────────────
  const commitments =
    envelope.section === "commitment" || envelope.section === "debt"
      ? await db
          .select()
          .from(budgetCommitments)
          .where(and(eq(budgetCommitments.envelopeId, envelope.id), eq(budgetCommitments.planId, plan.id)))
          .orderBy(asc(budgetCommitments.firstDueDate))
      : []

  // ── audit trail ───────────────────────────────────────────────────────────
  const events = await db
    .select()
    .from(budgetEvents)
    .where(and(eq(budgetEvents.organizationId, orgId), eq(budgetEvents.envelopeId, envelope.id)))
    .orderBy(desc(budgetEvents.createdAt))
    .limit(50)

  return res.json({
    envelope: serialize(envelope),
    today,
    period: open
      ? { id: open.id, start: open.start, end_exclusive: open.endExclusive, status: open.status }
      : null,
    history: historyRows.map((h) => {
      const line = h.period.status === "closed" ? snapshotLine(h.snapshot) : null
      // Planned comes from the snapshot for a closed period so a later edit to
      // the allocation cannot retroactively change it.
      const planned =
        line != null
          ? round2(num(line.planned))
          : round2(num(h.allocation.plannedAmount) + num(h.allocation.rolloverIn))
      const spent = line != null ? round2(num(line.spent_net)) : null
      return {
        period_id: h.period.id,
        start: h.period.start,
        end_exclusive: h.period.endExclusive,
        status: h.period.status,
        // The name AS AT close, so a rename does not rewrite history.
        name_at_close: line?.name ?? null,
        planned,
        rollover_in: round2(num(line?.rollover_in ?? h.allocation.rolloverIn)),
        authored_amount: round2(num(h.allocation.authoredAmount)),
        authored_cadence: h.allocation.authoredCadence,
        contribution_status: h.allocation.contributionStatus,
        spent_net: spent,
        pending_at_close: line == null ? null : round2(num(line.pending_at_close)),
        refunds_confirmed: line == null ? null : round2(num(line.refunds_confirmed)),
        remaining: spent == null ? null : remaining(planned, spent),
        state: spent == null ? null : state(spent, planned),
        // A restated period is clearly labelled rather than quietly corrected.
        snapshot_version: h.snapshotVersion ?? null,
        restated_reason: h.restatedReason ?? null,
      }
    }),
    transactions: txRows,
    settlements: settlementRows,
    commitments: commitments.map(serialize),
    events: events.map(serialize),
  })
}
