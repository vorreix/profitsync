import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { categories, clients, debtDetails, debtPayments, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { cardDebt, isLiabilityType } from "../../src/lib/credit-card.js"
import { addPeriods, amortize, fromCents, monthKey, monthlyEquivalent, nextDueAfter, periodsPerYear, splitPayment, toCents, type PaymentFrequency } from "../../src/lib/debt-math.js"
import {
  debtFreeEstimate,
  debtInsights,
  derivedStatus,
  isOpenDebt,
  monthObligations,
  nextPayment,
  normalizeSplit,
  overallDebtFreeDate,
  owedByCurrency,
  progressPct,
  requiredMonthly,
  upcomingSchedule,
  type DebtLifecycle,
  type DebtLike,
} from "../../src/lib/debt-status.js"
import { todayIso } from "../../src/lib/recurring.js"
import { logoDataUrl } from "../../src/lib/logo-data.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { logAudit } from "./audit.js"
import { ensureDefaultClient } from "./auth.js"
import { getOrgPlan } from "./quota.js"

// Debt & Loans engine: SQL + orchestration only. Every formula lives in
// src/lib/debt-math.ts / debt-status.ts (pure, unit-tested); the routes stay thin.
//
// A debt is a wealth account of type 'loan' (I owe; balance negative) or
// 'receivable' (owed to me; balance positive) plus a debt_details row. The
// balance moves ONLY through the ledger (transfers + standard rows), never by
// writing a number here — the same rule every other account follows.

export const DEBT_ACCOUNT_TYPES = ["loan", "receivable"] as const
export type DebtDirection = "owed" | "receivable"
export const DEBT_KINDS = ["mortgage", "personal", "car", "student", "business", "bnpl", "overdraft", "informal", "other"] as const
export type DebtKind = (typeof DEBT_KINDS)[number]

type AccountRow = typeof wealthAccounts.$inferSelect
type DetailsRow = typeof debtDetails.$inferSelect
type PaymentRow = typeof debtPayments.$inferSelect
export type DebtRow = { account: AccountRow; details: DetailsRow }

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const isDebtAccountType = (type: string | null | undefined): boolean => type === "loan" || type === "receivable"
export const directionOf = (type: string): DebtDirection => (type === "receivable" ? "receivable" : "owed")

/** Outstanding amount (positive) regardless of direction. */
export function outstandingOf(account: Pick<AccountRow, "type" | "currentBalance">): number {
  return account.type === "receivable" ? Math.max(0, num(account.currentBalance)) : cardDebt(account.currentBalance)
}

export async function loadDebts(orgId: string, opts: { includeClosed?: boolean } = {}): Promise<DebtRow[]> {
  const rows = await db
    .select({ account: wealthAccounts, details: debtDetails })
    .from(debtDetails)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, debtDetails.wealthAccountId))
    .where(
      and(
        eq(debtDetails.organizationId, orgId),
        inArray(wealthAccounts.type, [...DEBT_ACCOUNT_TYPES]),
        opts.includeClosed ? undefined : isNull(wealthAccounts.archivedAt),
      ),
    )
    .orderBy(wealthAccounts.position, wealthAccounts.createdAt)
  return rows
}

export async function loadDebt(orgId: string, accountId: string): Promise<DebtRow | null> {
  const [row] = await db
    .select({ account: wealthAccounts, details: debtDetails })
    .from(debtDetails)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, debtDetails.wealthAccountId))
    .where(and(eq(debtDetails.organizationId, orgId), eq(wealthAccounts.id, accountId)))
  return row ?? null
}

export function toDebtLike(row: DebtRow): DebtLike {
  const d = row.details
  return {
    id: row.account.id,
    name: row.account.nickname.trim() || row.account.bankName || d.counterparty,
    lifecycle: d.lifecycle as DebtLifecycle,
    owed: toCents(outstandingOf(row.account)),
    original: d.originalAmount == null ? null : toCents(d.originalAmount),
    annualRatePct: d.annualRatePct == null ? null : num(d.annualRatePct),
    paymentAmount: d.paymentAmount == null ? null : toCents(d.paymentAmount),
    frequency: (d.paymentFrequency as PaymentFrequency | null) ?? null,
    nextDueDate: d.nextDueDate,
    currency: d.currency,
  }
}

/** The JSON shape of one debt (snake_case like every other row) + derived facts. */
export function serializeDebt(row: DebtRow, today: string) {
  const like = toDebtLike(row)
  const estimate = debtFreeEstimate(like, today)
  const { logoData, ...account } = row.account
  return serialize({
    id: row.account.id,
    direction: directionOf(row.account.type),
    name: like.name,
    icon: account.icon,
    logoSrc: logoDataUrl(logoData),
    brandDomain: account.brandDomain,
    position: account.position,
    archivedAt: account.archivedAt,
    createdAt: account.createdAt,
    kind: row.details.kind,
    counterparty: row.details.counterparty,
    currency: row.details.currency,
    // Positive outstanding amount + the raw signed ledger balance for callers that need it.
    balance: fromCents(like.owed),
    balanceSigned: num(account.currentBalance),
    originalAmount: row.details.originalAmount == null ? null : num(row.details.originalAmount),
    annualRatePct: like.annualRatePct,
    rateType: row.details.rateType,
    paymentAmount: row.details.paymentAmount == null ? null : num(row.details.paymentAmount),
    paymentFrequency: row.details.paymentFrequency,
    paymentMonthly: fromCents(monthlyEquivalent(like.paymentAmount ?? 0, like.frequency)),
    nextDueDate: row.details.nextDueDate,
    startDate: row.details.startDate,
    maturityDate: row.details.maturityDate,
    remainingInstallments: row.details.remainingInstallments,
    balanceIsEstimate: row.details.balanceIsEstimate,
    lifecycle: row.details.lifecycle,
    status: derivedStatus(like, today),
    progressPct: progressPct(like.original, like.owed),
    estimate,
    refinancedIntoAccountId: row.details.refinancedIntoAccountId,
    closedAt: row.details.closedAt,
    notes: row.details.notes,
    updatedAt: row.details.updatedAt,
  })
}

/** LIVE payments (anchor leg not trashed) for a set of debt accounts, newest first. */
export async function loadPayments(orgId: string, accountIds: string[], opts: { from?: string; to?: string; limit?: number } = {}) {
  if (accountIds.length === 0) return [] as PaymentRow[]
  const q = db
    .select({ p: debtPayments })
    .from(debtPayments)
    .innerJoin(transactions, eq(transactions.id, debtPayments.transactionId))
    .where(
      and(
        eq(debtPayments.organizationId, orgId),
        inArray(debtPayments.wealthAccountId, accountIds),
        isNull(transactions.deletedAt),
        opts.from ? gte(debtPayments.date, opts.from) : undefined,
        opts.to ? lt(debtPayments.date, opts.to) : undefined,
      ),
    )
    .orderBy(desc(debtPayments.date), desc(debtPayments.createdAt))
  const rows = opts.limit ? await q.limit(opts.limit) : await q
  return rows.map((r) => r.p)
}

/** Net monthly income over the last 3 whole months (standard incoming, non-system) — for the debt-payment ratio. */
async function averageMonthlyIncome(orgId: string, today: string): Promise<number> {
  const from = addPeriods(`${monthKey(today)}-01`, "monthly", -3)
  const to = `${monthKey(today)}-01`
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)` })
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
        gte(transactions.date, from),
        lt(transactions.date, to),
      ),
    )
  return Math.round((num(row?.total) / 3) * 100) / 100
}

/** Everything the Debt Hub renders, in one response. */
export async function buildDebtsOverview(orgId: string, orgCurrency: string, today = todayIso()) {
  const rows = await loadDebts(orgId, { includeClosed: true })
  const active = rows.filter((r) => !r.account.archivedAt)
  const owedRows = active.filter((r) => r.account.type === "loan")
  const receivableRows = active.filter((r) => r.account.type === "receivable")
  const owedLike = owedRows.map(toDebtLike)
  const receivableLike = receivableRows.map(toDebtLike)
  const ids = active.map((r) => r.account.id)

  const monthStart = `${monthKey(today)}-01`
  const nextMonthStart = addPeriods(monthStart, "monthly", 1)
  const threeMonthsOut = addPeriods(monthStart, "monthly", 3)
  const [monthPayments, windowPayments, incomeAvg] = await Promise.all([
    loadPayments(orgId, ids, { from: monthStart, to: nextMonthStart }),
    loadPayments(orgId, ids, { from: monthStart, to: threeMonthsOut }),
    averageMonthlyIncome(orgId, today),
  ])
  const owedIds = new Set(owedRows.map((r) => r.account.id))
  const paidThisMonth = new Map<string, number>()
  let interestThisMonth = 0
  for (const p of monthPayments) {
    if (!owedIds.has(p.wealthAccountId)) continue
    paidThisMonth.set(p.wealthAccountId, (paidThisMonth.get(p.wealthAccountId) ?? 0) + toCents(p.total))
    interestThisMonth += toCents(p.interest) + toCents(p.fees) + toCents(p.other)
  }
  const paidByMonth = new Map<string, number>()
  for (const p of windowPayments) {
    const k = `${p.wealthAccountId}:${monthKey(p.date)}`
    paidByMonth.set(k, (paidByMonth.get(k) ?? 0) + toCents(p.total))
  }

  const estimates = new Map(owedLike.map((d) => [d.id, debtFreeEstimate(d, today)]))
  const open = owedLike.filter(isOpenDebt)
  const obligations = monthObligations(owedLike, today, paidThisMonth)
  const next = nextPayment(owedLike, today)
  const required = requiredMonthly(owedLike)
  const totalRepaid = (await db
    .select({ total: sql<string>`coalesce(sum(${debtPayments.principal}::numeric), 0)` })
    .from(debtPayments)
    .innerJoin(transactions, eq(transactions.id, debtPayments.transactionId))
    .where(and(eq(debtPayments.organizationId, orgId), isNull(transactions.deletedAt), inArray(debtPayments.wealthAccountId, owedRows.length ? owedRows.map((r) => r.account.id) : ["00000000-0000-0000-0000-000000000000"]))))[0]

  return {
    today,
    currency: orgCurrency,
    debts: owedRows.map((r) => serializeDebt(r, today)),
    receivables: receivableRows.map((r) => serializeDebt(r, today)),
    closed: rows.filter((r) => !!r.account.archivedAt).map((r) => serializeDebt(r, today)),
    summary: serialize({
      openCount: open.length,
      owedByCurrency: owedByCurrency(owedLike).map((x) => ({ currency: x.currency, amount: fromCents(x.owed) })),
      receivableByCurrency: owedByCurrency(receivableLike).map((x) => ({ currency: x.currency, amount: fromCents(x.owed) })),
      requiredMonthly: fromCents(required),
      month: {
        required: fromCents(obligations.required),
        paid: fromCents(obligations.paid),
        remaining: fromCents(obligations.remaining),
        overdue: fromCents(obligations.overdue),
      },
      nextPayment: next ? { debtId: next.debt.id, name: next.debt.name, date: next.date, amount: fromCents(next.amount), currency: next.debt.currency } : null,
      overdueCount: owedLike.filter((d) => derivedStatus(d, today) === "overdue").length,
      interestThisMonth: fromCents(interestThisMonth),
      debtFreeDate: overallDebtFreeDate(estimates, open),
      totalRepaid: num(totalRepaid?.total),
      averageMonthlyIncome: incomeAvg,
      insights: debtInsights({ debts: owedLike, today, interestPaidThisMonth: interestThisMonth, currency: orgCurrency, estimates }),
    }),
    upcoming: upcomingSchedule(owedLike, today, 3, paidByMonth).map((s) => ({
      debt_id: s.debtId,
      date: s.date,
      amount: fromCents(s.amount),
      paid: s.paid,
      paid_amount: fromCents(s.paidAmount),
    })),
  }
}

// ── Payments ─────────────────────────────────────────────────────────────────

/** Existing expense categories to file interest / fees under (never invents new rows). */
async function componentCategories(orgId: string): Promise<{ interest: string; fees: string; other: string }> {
  const rows = await db
    .select({ name: categories.name, type: categories.type })
    .from(categories)
    .where(and(eq(categories.organizationId, orgId), eq(categories.type, "outgoing")))
  const names = rows.map((r) => r.name)
  const pick = (patterns: RegExp[], fallback: string) => {
    for (const re of patterns) {
      const hit = names.find((n) => re.test(n))
      if (hit) return hit
    }
    return fallback
  }
  return {
    interest: pick([/interest/i], "Interest"),
    fees: pick([/fee/i, /bank/i, /charge/i], "Fees"),
    other: pick([/insurance/i, /loan/i], "Loan charges"),
  }
}

export type RecordPaymentInput = {
  counterAccountId: string
  date: string
  total: number
  principal?: number | null
  interest?: number | null
  fees?: number | null
  other?: number | null
  note?: string
  /** Advance next_due_date / remaining_installments after recording (default true). */
  advanceSchedule?: boolean
}

export type RecordPaymentResult =
  | { ok: true; payment: PaymentRow }
  | { ok: false; status: number; error: string; quota?: unknown }

/**
 * Record one repayment as ONE ledger group:
 *   principal → TRANSFER legs  (counter account → debt account)   never an expense
 *   interest  → standard OUTGOING on the counter account            a real expense
 *   fees/other→ standard OUTGOING on the counter account            real expenses
 * plus a debt_payments allocation row anchored on the first leg. For a
 * receivable ("owed to me") the direction flips: principal flows debt → counter
 * account and interest received is INCOME on the counter account.
 *
 * Split resolution: an explicit principal/interest/fees split is used as typed
 * ("entered"); otherwise a known rate splits one period's interest off the top
 * ("calculated"); otherwise everything is principal ("principal_only").
 */
export async function recordDebtPayment(orgId: string, userId: string, row: DebtRow, input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const direction = directionOf(row.account.type)
  const like = toDebtLike(row)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, status: 400, error: "date must be YYYY-MM-DD" }
  const totalCents = toCents(input.total)
  if (totalCents <= 0) return { ok: false, status: 400, error: "amount must be greater than 0" }

  const [counter] = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, input.counterAccountId), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  if (!counter || counter.type === "space" || isDebtAccountType(counter.type)) {
    return { ok: false, status: 400, error: "Choose an active bank, cash or card account to pay from" }
  }

  // Resolve the split.
  let split: { total: number; principal: number; interest: number; fees: number; other: number }
  let splitSource: "entered" | "calculated" | "principal_only"
  const explicit = input.principal != null || input.interest != null || input.fees != null || input.other != null
  if (explicit) {
    const n = normalizeSplit({ total: input.total, principal: input.principal, interest: input.interest, fees: input.fees, other: input.other })
    if (!n) return { ok: false, status: 400, error: "Principal, interest and fees must add up to the total" }
    split = n
    splitSource = "entered"
  } else {
    const s = splitPayment({ total: totalCents, balance: like.owed, annualRatePct: like.annualRatePct, frequency: like.frequency })
    // A payment larger than what is owed: the excess is principal (the ledger may
    // go into credit; the UI shows an overpayment) — but interest never exceeds
    // one period's worth.
    const principal = totalCents - s.interest
    split = { total: totalCents, principal, interest: s.interest, fees: 0, other: 0 }
    splitSource = s.source
  }
  if (split.principal <= 0 && split.interest <= 0 && split.fees <= 0 && split.other <= 0) {
    return { ok: false, status: 400, error: "Nothing to record" }
  }

  const clientId = await ensureDefaultClient(orgId, userId)
  // Plan quota: every leg is a transaction on the anchor client (mirrors transfer.ts).
  const legCount = (split.principal > 0 ? 2 : 0) + (split.interest > 0 ? 1 : 0) + (split.fees > 0 ? 1 : 0) + (split.other > 0 ? 1 : 0)
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey === "free") {
    const [{ current }] = await db
      .select({ current: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt), eq(transactions.isSystem, false)))
    if (Number(current) + legCount > limits.transactionsPerClient) {
      return {
        ok: false,
        status: 402,
        error: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`,
        quota: { allowed: false, reason: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`, limit: limits.transactionsPerClient, current, upgradeHint: true },
      }
    }
  }

  const cats = await componentCategories(orgId)
  const name = like.name
  const counterName = counter.nickname.trim() || counter.bankName
  const noteText = (input.note ?? "").trim()
  const suffix = noteText ? ` — ${noteText}` : ""
  const groupId = crypto.randomUUID()
  const insertedIds: string[] = []
  const shifts = new Map<string, number>()
  const bump = (accountId: string, delta: number) => shifts.set(accountId, (shifts.get(accountId) ?? 0) + delta)

  const insertLeg = async (values: {
    accountId: string; kind: "transfer" | "standard"; type: "incoming" | "outgoing"; amount: number; description: string; category: string
  }) => {
    const [leg] = await db
      .insert(transactions)
      .values({
        clientId,
        wealthAccountId: values.accountId,
        groupId,
        kind: values.kind,
        type: values.type,
        amount: fromCents(values.amount).toFixed(2),
        description: values.description,
        category: values.category,
        date: input.date,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: transactions.id })
    insertedIds.push(leg.id)
    bump(values.accountId, balanceDelta(values.type, fromCents(values.amount)))
  }

  if (split.principal > 0) {
    if (direction === "owed") {
      await insertLeg({ accountId: counter.id, kind: "transfer", type: "outgoing", amount: split.principal, description: `Loan payment to ${name}${suffix}`, category: "Transfer" })
      await insertLeg({ accountId: row.account.id, kind: "transfer", type: "incoming", amount: split.principal, description: `Loan payment from ${counterName}${suffix}`, category: "Transfer" })
    } else {
      await insertLeg({ accountId: row.account.id, kind: "transfer", type: "outgoing", amount: split.principal, description: `Repayment to ${counterName}${suffix}`, category: "Transfer" })
      await insertLeg({ accountId: counter.id, kind: "transfer", type: "incoming", amount: split.principal, description: `Repayment from ${name}${suffix}`, category: "Transfer" })
    }
  }
  if (split.interest > 0) {
    // Interest I pay is an expense; interest paid TO me is income.
    await insertLeg({
      accountId: counter.id, kind: "standard", type: direction === "owed" ? "outgoing" : "incoming",
      amount: split.interest, description: `Interest — ${name}${suffix}`, category: cats.interest,
    })
  }
  if (split.fees > 0) await insertLeg({ accountId: counter.id, kind: "standard", type: "outgoing", amount: split.fees, description: `Fees — ${name}${suffix}`, category: cats.fees })
  if (split.other > 0) await insertLeg({ accountId: counter.id, kind: "standard", type: "outgoing", amount: split.other, description: `Charges — ${name}${suffix}`, category: cats.other })

  // Relative balance updates — one UPDATE per account (same pattern as every money path).
  for (const [accountId, delta] of shifts) {
    await db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${delta.toFixed(2)}::numeric`, updatedBy: userId, updatedAt: new Date() })
      .where(eq(wealthAccounts.id, accountId))
  }

  const [payment] = await db
    .insert(debtPayments)
    .values({
      organizationId: orgId,
      wealthAccountId: row.account.id,
      transactionId: insertedIds[0],
      groupId,
      date: input.date,
      total: fromCents(split.total).toFixed(2),
      principal: fromCents(split.principal).toFixed(2),
      interest: fromCents(split.interest).toFixed(2),
      fees: fromCents(split.fees).toFixed(2),
      other: fromCents(split.other).toFixed(2),
      splitSource,
      note: noteText,
      createdBy: userId,
    })
    .returning()

  // Move the schedule forward: the next due date is the first scheduled date
  // after this payment (paying early still counts for the coming instalment).
  if (input.advanceSchedule !== false && row.details.nextDueDate && row.details.paymentFrequency && row.details.paymentFrequency !== "irregular") {
    const freq = row.details.paymentFrequency as PaymentFrequency
    const nextDue = input.date < row.details.nextDueDate ? addPeriods(row.details.nextDueDate, freq, 1) : nextDueAfter(row.details.nextDueDate, freq, input.date)
    await db
      .update(debtDetails)
      .set({
        nextDueDate: nextDue,
        ...(row.details.remainingInstallments != null && row.details.remainingInstallments > 0 ? { remainingInstallments: row.details.remainingInstallments - 1 } : {}),
        updatedAt: new Date(),
      })
      .where(eq(debtDetails.id, row.details.id))
  }

  for (const id of insertedIds) await logAudit({ orgId, entityType: "transaction", entityId: id, action: "create", actorId: userId })
  await logAudit({ orgId, entityType: "wealth_account", entityId: row.account.id, action: "update", actorId: userId, changes: { debt_payment: { from: null, to: fromCents(split.total) } } })
  return { ok: true, payment }
}

/** Amortization schedule for the detail screen, dated from the next due date. Null when it can't be computed. */
export function scheduleFor(row: DebtRow, today: string, maxRows = 360) {
  const like = toDebtLike(row)
  const ppy = periodsPerYear(like.frequency)
  if (!ppy || !like.paymentAmount || like.owed <= 0 || !like.frequency || like.frequency === "irregular") return null
  const result = amortize({ balance: like.owed, annualRatePct: like.annualRatePct ?? 0, payment: like.paymentAmount, ppy, maxPeriods: maxRows })
  if (!result.converges && result.rows.length === 0) return null
  const anchor = like.nextDueDate ?? today
  return {
    converges: result.converges,
    total_interest: fromCents(result.totalInterest),
    periods: result.periods,
    assumed_zero_rate: like.annualRatePct == null,
    rows: result.rows.map((r) => ({
      period: r.period,
      date: addPeriods(anchor, like.frequency as PaymentFrequency, r.period - 1),
      payment: fromCents(r.payment),
      interest: fromCents(r.interest),
      principal: fromCents(r.principal),
      balance: fromCents(r.balance),
    })),
  }
}

/** True when the user's money is a liability held in a debt account (used by the transaction guards). */
export const isLiabilityOrDebtType = (type: string | null | undefined) => isLiabilityType(type) || isDebtAccountType(type)

export { or }
