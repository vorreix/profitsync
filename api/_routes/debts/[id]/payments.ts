import type { VercelRequest, VercelResponse } from "@vercel/node"
import { serialize } from "../../../../src/lib/db/index.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { loadDebt, loadPayments, recordDebtPayment, serializeDebt } from "../../../_lib/debts.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import { todayIso } from "../../../../src/lib/recurring.js"

/**
 * GET  /api/debts/:id/payments — live payment history (newest first).
 * POST /api/debts/:id/payments — record a repayment: `{ from_account_id, date,
 *      amount, principal?, interest?, fees?, other?, note? }`. Principal is a
 *      transfer to the debt account, interest/fees are real expenses on the
 *      paying account; one ledger group + one allocation row. See
 *      api/_lib/debts.ts recordDebtPayment for the split rules.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  const row = await loadDebt(orgId, id)
  if (!row) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    const payments = await loadPayments(orgId, [id], { limit: 500 })
    return res.json(payments.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    if (row.account.archivedAt) return res.status(400).json({ error: "This debt is closed" })
    const b = (req.body ?? {}) as Record<string, unknown>
    const amount = Number(b.amount ?? b.total)
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be greater than 0" })
    if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    const opt = (k: string): number | null | undefined => {
      if (b[k] === undefined) return undefined
      if (b[k] === null || b[k] === "") return null
      const n = Number(b[k])
      return Number.isFinite(n) ? n : NaN
    }
    const parts = { principal: opt("principal"), interest: opt("interest"), fees: opt("fees"), other: opt("other") }
    for (const v of Object.values(parts)) if (typeof v === "number" && (Number.isNaN(v) || v < 0)) return res.status(400).json({ error: "Split amounts must be 0 or more" })

    const result = await recordDebtPayment(orgId, userId, row, {
      counterAccountId: String(b.from_account_id ?? b.to_account_id ?? ""),
      date: typeof b.date === "string" && b.date ? b.date : todayIso(),
      total: amount,
      principal: parts.principal ?? undefined,
      interest: parts.interest ?? undefined,
      fees: parts.fees ?? undefined,
      other: parts.other ?? undefined,
      note: typeof b.note === "string" ? b.note : "",
      advanceSchedule: b.advance_schedule !== false,
    })
    if (!result.ok) return res.status(result.status).json(result.quota ?? { error: result.error })
    const after = (await loadDebt(orgId, id))!
    return res.status(201).json({ payment: serialize(result.payment), debt: serializeDebt(after, todayIso()) })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
