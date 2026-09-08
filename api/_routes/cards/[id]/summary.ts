import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, gte, isNull, sql } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { cards, transactions, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../_lib/auth.js"
import { loadCard, serializeCard } from "../../../_lib/cards.js"
import { syncCards } from "../../../_lib/card-autopay.js"
import { loadCardSummary } from "../../../_lib/credit-card.js"
import { autopayPreview } from "../../../../src/lib/cards.js"
import { todayIso } from "../../../../src/lib/recurring.js"

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * GET /api/cards/:id/summary — everything the card screen shows beyond the row:
 * a credit card's ledger-derived view (owed / statement / cycle) plus the next
 * scheduled autopay; a debit card's activity this month. Runs the card sync
 * first so a card opened after its closing/due day is already up to date.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx
  const { id } = req.query as { id: string }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return res.status(404).json({ error: "Not found" })

  await syncCards(orgId).catch((err) => console.error("[cards] sync failed", err))
  const full = await loadCard(orgId, id)
  if (!full) return res.status(404).json({ error: "Not found" })
  const [card] = await db.select().from(cards).where(and(eq(cards.id, id), eq(cards.organizationId, orgId)))
  const [account] = await db.select().from(wealthAccounts).where(eq(wealthAccounts.id, card.accountId))
  if (!account) return res.status(404).json({ error: "Not found" })
  const today = todayIso()

  if (card.kind === "credit") {
    const summary = await loadCardSummary(account, today)
    const statements = [summary.statement, ...summary.history].filter((s): s is NonNullable<typeof s> => !!s)
    const nextAutopay = autopayPreview(
      { autopay: card.autopay, autopay_since: card.autopaySince, funding_account_id: card.fundingAccountId, status: card.status },
      statements.map((s) => ({ id: s.id, due_date: s.due_date, remaining: s.remaining, autopay_status: s.autopay_status ?? null })),
    )
    const last = statements
      .filter((s) => s.autopay_status)
      .sort((a, b) => (b.autopay_at ?? "").localeCompare(a.autopay_at ?? ""))[0]
    return res.json({
      card: serializeCard(full),
      credit: summary,
      debit: null,
      next_autopay: nextAutopay ? { date: nextAutopay.date, amount: nextAutopay.amount } : null,
      last_autopay: last ? { status: last.autopay_status, at: last.autopay_at ?? null, group_id: last.autopay_group_id ?? null, statement_id: last.id } : null,
    })
  }

  // Debit: this calendar month's spend/refunds on the card + when it was last used.
  const monthStart = `${today.slice(0, 7)}-01`
  const [agg] = await db
    .select({
      spent: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' and ${transactions.kind} = 'standard' and ${transactions.isSystem} = false then ${transactions.amount}::numeric else 0 end), 0)`,
      refunds: sql<string>`coalesce(sum(case when ${transactions.kind} = 'refund' then ${transactions.amount}::numeric else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.cardId, id), isNull(transactions.deletedAt), gte(transactions.date, monthStart)))
  const [last] = await db
    .select({ date: sql<string | null>`max(${transactions.date})::text` })
    .from(transactions)
    .where(and(eq(transactions.cardId, id), isNull(transactions.deletedAt), eq(transactions.isSystem, false)))
  return res.json({
    card: serializeCard(full),
    credit: null,
    debit: { month_spent: num(agg?.spent), month_refunds: num(agg?.refunds), last_used: last?.date ?? null },
    next_autopay: null,
    last_autopay: null,
  })
}
