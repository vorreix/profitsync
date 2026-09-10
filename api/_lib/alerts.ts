// The rows behind the attention banner. SQL only — every decision about what is
// worth saying lives in src/lib/alerts.ts, which is pure and tested.
//
// TWO HARD CONSTRAINTS, both of which the rest of the card/account code
// violates for good reasons of its own:
//
//  1. READ-ONLY. Every other path to this data materialises money on the way
//     past: api/_routes/cards.ts and api/_routes/wealth/accounts.ts run
//     materializeDueRecurring + syncCards, and loadCardSummary INSERTs through
//     ensureStatements. This one must not — it is read by the app shell on
//     every screen, and a read that files statements and runs autopay as a side
//     effect of rendering a banner is not a read. `scripts/check-cache-map.mjs`
//     enforces the consequence: nothing here may import those helpers, and
//     /api/alerts is deliberately absent from ALWAYS_FETCH.
//
//  2. NO N+1. `paymentsAfter` is one aggregate per statement and both
//     loadCardSummary and syncCards call it in a loop; a workspace with thirty
//     cards would make thirty round trips every time the dashboard opened. The
//     statement query below does the whole org in one.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { and, eq, gt, gte, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { HORIZON_DAYS, POSTED_WINDOW_DAYS, isoAddDays, type AlertAccount, type AlertCard, type AlertPosted, type AlertRule, type ProjectionEvent } from "../../src/lib/alerts.js"
import type { FrequencyUnit } from "../../src/lib/recurring.js"
import { loadCards } from "./cards.js"
import { cardLabel } from "./notify-cards.js"

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v) || 0)

export type AlertData = {
  accounts: AlertAccount[]
  cards: AlertCard[]
  rules: AlertRule[]
  posted: AlertPosted[]
  scheduled: ProjectionEvent[]
  /** `${ruleId}:${dueDate}` for occurrences already materialized in the window. */
  alreadyPosted: Set<string>
}

type StatementRow = {
  id: string
  account_id: string
  due_date: string
  statement_balance: string
  paid: string
  autopay_status: string | null
  autopay_error: string | null
  autopay_at: string | null
}

type StatementInfo = NonNullable<AlertCard["statement"]>

/**
 * The newest statement per card, with what is still owed on it.
 *
 * `DISTINCT ON` picks one row per account — only the newest matters, because a
 * payment lands on the account rather than on a statement, so an older
 * statement's debt is already inside the newer one's balance. The LATERAL is
 * `paymentsAfter` for the whole org at once: incoming transfer legs dated after
 * the close are what "paid" means for a credit card.
 */
async function newestStatements(orgId: string): Promise<Map<string, StatementInfo>> {
  const { rows } = (await db.execute(sql`
    select s.id, s.wealth_account_id as account_id, s.due_date, s.statement_balance,
           s.autopay_status, s.autopay_error, s.autopay_at,
           coalesce(p.paid, 0) as paid
    from (
      select distinct on (wealth_account_id) *
      from credit_card_statements
      where organization_id = ${orgId}
      order by wealth_account_id, closing_date desc
    ) s
    left join lateral (
      select sum(t.amount::numeric) as paid
      from transactions t
      where t.wealth_account_id = s.wealth_account_id
        and t.kind = 'transfer' and t.type = 'incoming'
        and t.deleted_at is null and t.date > s.closing_date
    ) p on true
  `)) as unknown as { rows: StatementRow[] }

  const out = new Map<string, StatementInfo>()
  for (const r of rows) {
    const remaining = Math.round((num(r.statement_balance) - num(r.paid)) * 100) / 100
    out.set(r.account_id, {
      id: r.id,
      dueDate: String(r.due_date).slice(0, 10),
      remaining,
      // Autopay's own claim state machine. The pure layer needs all three to
      // tell "autopay has not had its turn" from "autopay tried and lost" —
      // and a read-only route can never trigger the reconcile that would
      // resolve a crashed claim, so it has to classify one itself.
      autopayStatus: r.autopay_status,
      autopayError: r.autopay_error,
      autopayAt: r.autopay_at ? Date.parse(r.autopay_at) : null,
    })
  }
  return out
}

/**
 * Occurrences already materialized inside the projection window.
 *
 * `next_due_at` is only a cursor, advanced as a side effect of the nine
 * money-materialising GETs. One of them can run between this query and the
 * balance read — /api/cards fires on the same page load — so today's charge may
 * already be inside `current_balance` while the cursor still points at it.
 * Projecting it again would charge the same money twice. The unique index
 * (recurring_rule_id, recurring_due_date) is exactly this fact.
 */
async function materializedOccurrences(orgId: string, today: string, until: string): Promise<Set<string>> {
  const rows = await db
    .select({ ruleId: transactions.recurringRuleId, dueDate: transactions.recurringDueDate })
    .from(transactions)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, transactions.wealthAccountId))
    .where(
      and(
        eq(wealthAccounts.organizationId, orgId),
        isNull(transactions.deletedAt),
        isNotNull(transactions.recurringRuleId),
        gte(transactions.recurringDueDate, today),
        lte(transactions.recurringDueDate, until),
      ),
    )
  return new Set(rows.filter((r) => r.ruleId && r.dueDate).map((r) => `${r.ruleId}:${String(r.dueDate).slice(0, 10)}`))
}

/**
 * Recurring transactions that landed on their own recently, one row per rule
 * per day.
 *
 * Scoped through `wealth_accounts` rather than `clients`: `transactions` has no
 * `organization_id`, and every row that can matter here has an account (one
 * without touches no balance and belongs on no banner).
 */
async function recentlyPosted(orgId: string, today: string): Promise<AlertPosted[]> {
  const since = isoAddDays(today, -POSTED_WINDOW_DAYS)
  // Grouped by the posting account's currency as well: a rule posts to ONE
  // account, so this never splits a rule's day — it only labels the sum with
  // the money it is in, so two currencies can never be added together here.
  const { rows } = (await db.execute(sql`
    select t.recurring_rule_id as rule_id, r.name as rule_name, t.type, t.date,
           wa.currency_code as currency,
           sum(t.amount::numeric) as amount, count(*)::int as count
    from transactions t
    join wealth_accounts wa on wa.id = t.wealth_account_id
    join recurring_rules r on r.id = t.recurring_rule_id
    where wa.organization_id = ${orgId}
      and t.recurring_rule_id is not null
      and t.deleted_at is null
      and t.date >= ${since} and t.date <= ${today}
      and t.kind <> 'transfer'
    group by t.recurring_rule_id, r.name, t.type, t.date, wa.currency_code
    order by t.date desc
  `)) as unknown as { rows: { rule_id: string; rule_name: string; type: string; date: string; currency: string | null; amount: string; count: number }[] }

  return rows.map((r) => ({
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    type: r.type === "incoming" ? "incoming" : "outgoing",
    amount: num(r.amount),
    date: String(r.date).slice(0, 10),
    count: r.count,
    currency: r.currency ?? null,
  }))
}

/**
 * Transactions already dated in the future, as account movements.
 *
 * These are the reason the projection cannot start from `current_balance`. A
 * transaction applies its delta the moment it is created, with no date
 * condition (api/_routes/transactions.ts), so a row dated three weeks out is
 * ALREADY inside the stored balance. Adding future charges on top of it would
 * count them twice. Instead each of these is subtracted back out to give an
 * as-of-today baseline, then replayed on its own date.
 *
 * System rows are excluded: an "Opening Balance" or "Balance Adjustment"
 * *defines* what the balance is rather than flowing into it (see
 * src/lib/wealth-ledger.ts reversesOnTrash), so it was never added through
 * `balanceDelta` and must not be taken back out.
 */
async function scheduledLegs(orgId: string, today: string): Promise<ProjectionEvent[]> {
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.wealthAccountId,
      date: transactions.date,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, transactions.wealthAccountId))
    .where(
      and(
        eq(wealthAccounts.organizationId, orgId),
        isNull(transactions.deletedAt),
        gt(transactions.date, today),
        eq(transactions.isSystem, false),
      ),
    )

  return rows
    .filter((r) => r.accountId)
    .map((r) => ({
      date: String(r.date).slice(0, 10),
      accountId: r.accountId as string,
      delta: balanceDelta(r.type, r.amount),
      source: { kind: "scheduled" as const, id: r.id, name: r.description || "" },
    }))
}

/** Everything the alert rules need, in five concurrent set-based queries. */
export async function loadAlertData(orgId: string, today: string): Promise<AlertData> {
  const until = isoAddDays(today, HORIZON_DAYS)
  const [accountRows, cardRows, ruleRows, statements, posted, scheduled, alreadyPosted] = await Promise.all([
    db
      .select({
        id: wealthAccounts.id,
        type: wealthAccounts.type,
        bankName: wealthAccounts.bankName,
        nickname: wealthAccounts.nickname,
        currentBalance: wealthAccounts.currentBalance,
        creditLimit: wealthAccounts.creditLimit,
        archivedAt: wealthAccounts.archivedAt,
        currencyCode: wealthAccounts.currencyCode,
      })
      .from(wealthAccounts)
      .where(eq(wealthAccounts.organizationId, orgId)),
    // Read-only, and the one shape that already joins each card to its ledger
    // account. Closed cards are excluded — they alert about nothing.
    loadCards(orgId),
    db
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.organizationId, orgId), eq(recurringRules.active, true))),
    newestStatements(orgId),
    recentlyPosted(orgId, today),
    scheduledLegs(orgId, today),
    materializedOccurrences(orgId, today, until),
  ])

  // The as-of-today baseline: take the future-dated rows back out of the stored
  // balance so the projection can replay them on their own dates.
  const future = new Map<string, number>()
  for (const e of scheduled) future.set(e.accountId, (future.get(e.accountId) ?? 0) + e.delta)

  // Every figure an alert carries is labelled with ITS account's currency and
  // never converted — an alert is about one account, so its money is that
  // account's money. Cards and rules look theirs up through the account they
  // post to.
  const currencyByAccount = new Map(accountRows.map((a) => [a.id, a.currencyCode ?? null]))

  const accounts: AlertAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.nickname.trim() || a.bankName,
    type: (a.type as AlertAccount["type"]) ?? "bank",
    balanceToday: Math.round((num(a.currentBalance) - (future.get(a.id) ?? 0)) * 100) / 100,
    creditLimit: a.creditLimit === null ? null : num(a.creditLimit),
    archived: !!a.archivedAt,
    currency: a.currencyCode ?? null,
  }))

  const cards: AlertCard[] = cardRows.map((c) => ({
    id: c.id,
    label: cardLabel({ id: c.id, name: c.name, network: c.network, kind: c.kind, last4: c.last4, account_bank_name: c.accountBankName }),
    kind: c.kind === "credit" ? "credit" : "debit",
    status: c.accountArchivedAt ? "closed" : (c.status as AlertCard["status"]),
    autopay: !!c.autopay,
    expiryMonth: c.expiryMonth,
    expiryYear: c.expiryYear,
    accountId: c.accountId,
    creditLimit: c.accountCreditLimit === null ? null : num(c.accountCreditLimit),
    currentBalance: num(c.accountCurrentBalance),
    fundingAccountId: c.fundingAccountId,
    autopaySince: c.autopaySince ? String(c.autopaySince).slice(0, 10) : null,
    statement: statements.get(c.accountId) ?? null,
    currency: currencyByAccount.get(c.accountId) ?? null,
  }))

  const rules: AlertRule[] = ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type === "incoming" ? "incoming" : "outgoing",
    kind: r.kind === "transfer" ? "transfer" : "standard",
    amount: num(r.amount),
    accountId: r.wealthAccountId,
    toAccountId: r.toAccountId,
    cardId: r.cardId,
    anchor: String(r.startDate).slice(0, 10),
    freq: { unit: r.frequencyUnit as FrequencyUnit, interval: r.frequencyInterval },
    cursor: String(r.nextDueAt).slice(0, 10),
    end: r.endDate ? String(r.endDate).slice(0, 10) : null,
    active: r.active,
    lastError: r.lastError ?? "",
    currency: r.wealthAccountId ? (currencyByAccount.get(r.wealthAccountId) ?? null) : null,
  }))

  return { accounts, cards, rules, posted, scheduled, alreadyPosted }
}
