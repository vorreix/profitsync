import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, gte, isNull, sql } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { cards, transactions, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../_lib/auth.js"
import { loadCard, sameNativeCurrency, serializeCard } from "../../../_lib/cards.js"
import { AUTOPAY_CURRENCY_MISMATCH, syncCards } from "../../../_lib/card-autopay.js"
import { loadCardSummary } from "../../../_lib/credit-card.js"
import { autopayDeferred, autopayPreview } from "../../../../src/lib/cards.js"
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
    // A payer in another currency is one autopay will refuse (card-autopay.ts):
    // never promise a payment that is not going to happen.
    const payable = !card.fundingAccountId || (await sameNativeCurrency(orgId, full.fundingAccountCurrencyCode, full.accountCurrencyCode))
    const nextAutopay = payable && autopayPreview(
      { autopay: card.autopay, autopay_since: card.autopaySince, funding_account_id: card.fundingAccountId, status: card.status },
      statements.map((s) => ({ id: s.id, due_date: s.due_date, remaining: s.remaining, autopay_status: s.autopay_status ?? null, autopay_error: s.autopay_error })),
    )
    // The last attempt — a DEFERRED one included (MC-087): the sync above just
    // retried it and it handed the statement back again, so it reads as failed
    // (with "Pay manually") rather than vanishing behind an older success. A
    // deferral releases its claim time, so its due date (when autopay tried)
    // orders it. Once the user has paid it themselves it is nothing to act on.
    const last = statements
      .filter((s) => s.autopay_status || (autopayDeferred(s) && s.remaining > 0))
      .sort((a, b) => (b.autopay_at ?? b.due_date).localeCompare(a.autopay_at ?? a.due_date))[0]
    const deferred = !!last && autopayDeferred(last)
    // A REVERSED autopay keeps autopay_status='paid' on purpose — the engine
    // must not move the money again by itself — but the statement is owed
    // again (PAID_LEG_SQL nets the reversal), so the panel must not show a
    // green "paid" tick beside it: report it failed, with "Pay manually".
    const reversed = !!last && last.autopay_status === "paid" && !!last.autopay_group_id && last.remaining > 0 &&
      ((await db.execute(sql`
        select 1 from transfers x
        join transfers r on r.reverses_transfer_id = x.id and r.deleted_at is null
        where x.group_id = ${last.autopay_group_id} and x.organization_id = ${orgId}
        limit 1
      `)) as unknown as { rows: unknown[] }).rows.length > 0
    return res.json({
      card: serializeCard(full),
      credit: summary,
      debit: null,
      next_autopay: nextAutopay ? { date: nextAutopay.date, amount: nextAutopay.amount } : null,
      last_autopay: last
        ? {
            status: deferred || reversed ? "failed" : last.autopay_status,
            at: last.autopay_at ?? (deferred ? last.due_date : null),
            group_id: last.autopay_group_id ?? null,
            statement_id: last.id,
            // A stable code, never the stored English text.
            reason: deferred ? "autopay_deferred" : reversed ? "autopay_reversed" : last.autopay_error === AUTOPAY_CURRENCY_MISMATCH ? AUTOPAY_CURRENCY_MISMATCH : null,
          }
        : null,
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
