import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { creditCardStatements, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import {
  closingsDue,
  creditUsage,
  cycleActivity,
  debtAtClose,
  dueDateFor,
  isLiabilityType,
  isValidDayOfMonth,
  lastClosingOnOrBefore,
  addDays,
  openCycle,
  statementView,
  type CreditUsage,
  type CycleActivity,
  type StatementView,
} from "../../src/lib/credit-card.js"
import { todayIso } from "../../src/lib/recurring.js"

// Server side of credit cards: files closed statements (SQL only — every
// formula lives in src/lib/credit-card.ts) and assembles the card summary the
// account screen renders. Same three-layer discipline as Budget v2: pure math →
// this engine → thin routes.

type AccountRow = typeof wealthAccounts.$inferSelect
type StatementRow = typeof creditCardStatements.$inferSelect

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Is this row a configured credit card (type + both cycle days set)? */
export function isConfiguredCard(a: Pick<AccountRow, "type" | "statementClosingDay" | "paymentDueDay">): boolean {
  return isLiabilityType(a.type) && isValidDayOfMonth(a.statementClosingDay) && isValidDayOfMonth(a.paymentDueDay)
}

/**
 * Signed balance effect (Σ balanceDelta) of the card's legs dated AFTER `date`
 * whose effect is currently applied — the same "applied" rule Budget v2 uses
 * (api/_lib/budget-engine.ts balanceMovedSince): a live row counts, and a
 * TRASHED SYSTEM row still counts because its balance effect was deliberately
 * not reversed (src/lib/wealth-ledger.ts reversesOnTrash).
 */
async function movementAfter(accountId: string, date: string): Promise<number> {
  const [row] = await db
    .select({
      moved: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else -${transactions.amount}::numeric end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.wealthAccountId, accountId),
        gt(transactions.date, date),
        or(isNull(transactions.deletedAt), eq(transactions.isSystem, true)),
      ),
    )
  return num(row?.moved)
}

/**
 * File every statement whose closing date has passed and is not on record yet.
 *
 * The anchor is the latest filed statement (any source), else the day the card
 * was added — so a card onboarded with "I don't know my last statement" starts
 * authoritative tracking at its first close after creation, and one onboarded
 * with a known statement continues from that close. Idempotent: the unique
 * (account, closing_date) index + onConflictDoNothing make a concurrent or
 * repeated run harmless. Capped per run (closingsDue) — the next read continues.
 */
export async function ensureStatements(account: AccountRow, today = todayIso()): Promise<void> {
  if (!isConfiguredCard(account)) return
  const closingDay = account.statementClosingDay!
  const dueDay = account.paymentDueDay!

  const [latest] = await db
    .select({ closingDate: creditCardStatements.closingDate })
    .from(creditCardStatements)
    .where(eq(creditCardStatements.wealthAccountId, account.id))
    .orderBy(desc(creditCardStatements.closingDate))
    .limit(1)

  const createdOn = account.createdAt ? account.createdAt.toISOString().slice(0, 10) : today
  const anchor = latest?.closingDate ?? createdOn
  const due = closingsDue(anchor, closingDay, today)
  if (due.length === 0) return

  // The balance at each close is reconstructed from the AUTHORITATIVE stored
  // balance minus everything that moved it after the close.
  let prevClose = anchor
  for (const closingDate of due) {
    const moved = await movementAfter(account.id, closingDate)
    const balance = debtAtClose(account.currentBalance, moved)
    await db
      .insert(creditCardStatements)
      .values({
        organizationId: account.organizationId,
        wealthAccountId: account.id,
        // First cycle after onboarding starts the day the card was added (or the
        // day after the previous close for every later cycle).
        cycleStart: prevClose === createdOn && !latest ? createdOn : addDays(prevClose, 1),
        closingDate,
        dueDate: dueDateFor(closingDate, dueDay),
        statementBalance: balance.toFixed(2),
        source: "computed",
        createdBy: account.createdBy,
      })
      .onConflictDoNothing({ target: [creditCardStatements.wealthAccountId, creditCardStatements.closingDate] })
    prevClose = closingDate
  }
}

/** Card payments (incoming TRANSFER legs, live) dated strictly after `date`. */
async function paymentsAfter(accountId: string, date: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.wealthAccountId, accountId),
        eq(transactions.kind, "transfer"),
        eq(transactions.type, "incoming"),
        isNull(transactions.deletedAt),
        gt(transactions.date, date),
      ),
    )
  return num(row?.paid)
}

export type StatementSummary = StatementView & {
  id: string
  cycle_start: string | null
  closing_date: string
  due_date: string
  source: string
}

export type CardSummary = {
  usage: CreditUsage
  /** The latest filed statement, or null when the card has no closed cycle on record yet. */
  statement: StatementSummary | null
  /** Older filed statements (most recent first, excluding `statement`), each with its own derived view. */
  history: StatementSummary[]
  cycle: CycleActivity & { start: string; closes_on: string; next_due_date: string | null }
}

function summarizeStatement(row: StatementRow, payments: number, today: string): StatementSummary {
  const view = statementView({
    statementBalance: row.statementBalance,
    paymentsSinceClose: payments,
    dueDate: row.dueDate,
    today,
  })
  return {
    ...view,
    id: row.id,
    cycle_start: row.cycleStart,
    closing_date: row.closingDate,
    due_date: row.dueDate,
    source: row.source,
  }
}

/**
 * Everything the card screen needs, computed from the ledger + statements.
 * Files any due statement first so a card opened after its closing day always
 * shows the new statement. `history` is bounded to the last 12 closes.
 */
export async function loadCardSummary(account: AccountRow, today = todayIso()): Promise<CardSummary> {
  await ensureStatements(account, today)

  const usage = creditUsage(account.creditLimit, account.currentBalance)
  const configured = isConfiguredCard(account)
  const closingDay = account.statementClosingDay ?? 1
  const dueDay = account.paymentDueDay ?? 1

  const rows = configured
    ? await db
        .select()
        .from(creditCardStatements)
        .where(eq(creditCardStatements.wealthAccountId, account.id))
        .orderBy(desc(creditCardStatements.closingDate))
        .limit(12)
    : []

  // Payments after each close: one small aggregate per filed statement (≤ 12).
  const summaries: StatementSummary[] = []
  for (const row of rows) {
    const payments = await paymentsAfter(account.id, row.closingDate)
    summaries.push(summarizeStatement(row, payments, today))
  }
  const [statement = null, ...history] = summaries

  // The open cycle: from the day after the last close (filed or, before the first
  // filing, the natural previous closing date) to the next closing date.
  const bounds = configured ? openCycle(today, closingDay) : null
  const cycleStart = statement
    ? addDays(statement.closing_date, 1)
    : bounds
      ? bounds.start
      : (account.createdAt ? account.createdAt.toISOString().slice(0, 10) : today)
  // A card whose first close hasn't happened yet: its open cycle began when it
  // was added, not on the previous natural closing date (nothing is on record before).
  const effectiveStart = statement ? cycleStart : configured
    ? (() => {
        const createdOn = account.createdAt ? account.createdAt.toISOString().slice(0, 10) : today
        const lastNatural = lastClosingOnOrBefore(today, closingDay)
        return createdOn > lastNatural ? createdOn : addDays(lastNatural, 1)
      })()
    : cycleStart
  const legs = await db
    .select({
      type: transactions.type,
      kind: transactions.kind,
      amount: transactions.amount,
      isSystem: transactions.isSystem,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.wealthAccountId, account.id),
        isNull(transactions.deletedAt),
        sql`${transactions.date} >= ${effectiveStart}`,
      ),
    )
  const activity = cycleActivity(legs)

  return {
    usage,
    statement,
    history,
    cycle: {
      ...activity,
      start: effectiveStart,
      closes_on: bounds ? bounds.closesOn : effectiveStart,
      next_due_date: bounds ? dueDateFor(bounds.closesOn, dueDay) : null,
    },
  }
}

/** Serialize a statement row for a JSON response (snake_case, numeric as string like every other row). */
export const serializeStatement = (row: StatementRow) => serialize(row)
