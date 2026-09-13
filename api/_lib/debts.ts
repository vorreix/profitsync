import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db, dbBatch, serialize } from "../../src/lib/db/index.js"
import { categories, clients, debtDetails, debtPayments, recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
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
import { todayIso, type FrequencyUnit } from "../../src/lib/recurring.js"
import { recurringToFrequency } from "../../src/lib/debt-recurring.js"
import { logoDataUrl } from "../../src/lib/logo-data.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { logAudit } from "./audit.js"
import { ensureDefaultClient } from "./auth.js"
import { getOrgPlan } from "./quota.js"
import { notifyIfBudgetExceeded } from "./notify-budget.js"

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

/**
 * The JSON shape of one debt (snake_case like every other row) + derived facts.
 *
 * `repaymentActive` says whether a recurring repayment is currently servicing
 * it. Which debts pay themselves and which need the user to act is the first
 * thing a list of debts has to answer, and it cannot be derived from the debt's
 * own columns — the schedule fields look identical either way.
 */
export function serializeDebt(row: DebtRow, today: string, opts: { repaymentActive?: boolean } = {}) {
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
    repaymentActive: opts.repaymentActive ?? false,
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

  // Which debts are being serviced by a live repayment — one query for all of
  // them, rather than one per row.
  const allRules = await loadDebtRules(orgId, active.map((r) => r.account.id))
  const servicing = new Set(allRules.filter((r) => r.active && r.debtAccountId).map((r) => r.debtAccountId as string))
  const withRule = (row: DebtRow) => ({ repaymentActive: servicing.has(row.account.id) })

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
    debts: owedRows.map((r) => serializeDebt(r, today, withRule(r))),
    receivables: receivableRows.map((r) => serializeDebt(r, today, withRule(r))),
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
  /**
   * Set by the recurring materializer. Makes the FIRST leg carry the recurring
   * keys, so the unique index on (recurring_rule_id, recurring_due_date) is what
   * decides whether this occurrence has already posted — the same idempotency
   * contract every other recurring money path uses. Never set by a hand-recorded
   * payment.
   */
  recurring?: { ruleId: string; dueDate: string }
  /**
   * The paying rule's true periods-per-year. Set by the materializer, because
   * a rule may run on a rhythm the debt's own `payment_frequency` has no word
   * for ("every 10 days" mirrors as "irregular"), and the interest for one
   * period must follow the rhythm that is actually taking the money.
   */
  periodsPerYear?: number | null
}

/**
 * Why a recurring occurrence wrote nothing.
 *
 *   "posted"   — a COMPLETE occurrence already exists (its allocation row is
 *                there). The caller may safely carry on to the next one: the
 *                balance it reads next will include this payment.
 *   "inflight" — the occurrence is claimed but not finished, and the claim is
 *                recent, so another materializer is mid-batch right now. The
 *                caller must STOP and leave its cursor alone; carrying on would
 *                size the next instalment against a balance that is about to
 *                change, and two runs would overshoot the debt into credit.
 */
export type SkippedReason = "posted" | "inflight"

export type RecordPaymentResult =
  | { ok: true; payment: PaymentRow; skipped?: undefined }
  | { ok: true; payment: null; skipped: SkippedReason }
  | { ok: false; status: number; error: string; quota?: unknown }

/**
 * How long a claimed-but-unfinished occurrence is assumed to be someone else's
 * work in progress. A batch is ONE HTTP round trip, so anything older than this
 * is not in flight — it is the wreckage of a run that died between claiming the
 * occurrence and committing it, and it must be cleared or that instalment can
 * never post again. Mirrors the credit-card autopay engine's stale-claim window.
 */
export const STALE_CLAIM_MS = 2 * 60 * 1000

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
 *
 * ATOMICITY. Every write lands in ONE dbBatch — the legs, each account's
 * balance, the allocation row and the schedule advance — so a payment can never
 * be observed half-applied (a balance moved with no row to explain it, or an
 * allocation pointing at a leg that was never inserted). The ids are generated
 * here rather than by the database precisely so the whole set can be one batch:
 * neon-http has no interactive transactions, so nothing may depend on reading
 * back an earlier statement's result.
 *
 * The one exception is a RECURRING occurrence, which needs two round trips by
 * construction: the anchor leg is inserted first with ON CONFLICT DO NOTHING,
 * and the batch only runs when that insert actually returned a row. That is the
 * same two-step the transfer materializer uses, for the same reason — the
 * conflict is the idempotency check, and its answer has to be known before the
 * rest of the money moves.
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
    const s = splitPayment({ total: totalCents, balance: like.owed, annualRatePct: like.annualRatePct, frequency: like.frequency, periodsPerYear: input.periodsPerYear })
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

  // Describe every leg first — nothing is written until the whole shape is known.
  type Leg = { id: string; accountId: string; kind: "transfer" | "standard"; type: "incoming" | "outgoing"; amount: number; description: string; category: string }
  const legs: Leg[] = []
  const leg = (v: Omit<Leg, "id">) => legs.push({ id: crypto.randomUUID(), ...v })

  // The COUNTER-ACCOUNT leg is always first, which makes it the anchor: it is
  // the leg on the account whose cash actually moved, in the direction the user
  // experienced. Everything that summarises "what this rule did" reads the
  // anchor, so anchoring on the debt side made a €500 repayment received into
  // the bank report as €6 of interest.
  if (split.principal > 0) {
    if (direction === "owed") {
      leg({ accountId: counter.id, kind: "transfer", type: "outgoing", amount: split.principal, description: `Loan payment to ${name}${suffix}`, category: "Transfer" })
      leg({ accountId: row.account.id, kind: "transfer", type: "incoming", amount: split.principal, description: `Loan payment from ${counterName}${suffix}`, category: "Transfer" })
    } else {
      leg({ accountId: counter.id, kind: "transfer", type: "incoming", amount: split.principal, description: `Repayment from ${name}${suffix}`, category: "Transfer" })
      leg({ accountId: row.account.id, kind: "transfer", type: "outgoing", amount: split.principal, description: `Repayment to ${counterName}${suffix}`, category: "Transfer" })
    }
  }
  if (split.interest > 0) {
    // Interest I pay is an expense; interest paid TO me is income.
    leg({
      accountId: counter.id, kind: "standard", type: direction === "owed" ? "outgoing" : "incoming",
      amount: split.interest, description: `Interest — ${name}${suffix}`, category: cats.interest,
    })
  }
  if (split.fees > 0) leg({ accountId: counter.id, kind: "standard", type: "outgoing", amount: split.fees, description: `Fees — ${name}${suffix}`, category: cats.fees })
  if (split.other > 0) leg({ accountId: counter.id, kind: "standard", type: "outgoing", amount: split.other, description: `Charges — ${name}${suffix}`, category: cats.other })

  const shifts = new Map<string, number>()
  for (const l of legs) shifts.set(l.accountId, (shifts.get(l.accountId) ?? 0) + balanceDelta(l.type, fromCents(l.amount)))

  const legValues = (l: Leg) => ({
    id: l.id,
    clientId,
    wealthAccountId: l.accountId,
    groupId,
    kind: l.kind,
    type: l.type,
    amount: fromCents(l.amount).toFixed(2),
    description: l.description,
    category: l.category,
    date: input.date,
    createdBy: userId,
    updatedBy: userId,
    // Only the ANCHOR carries the due date — the unique index it sits on must
    // never be able to conflict twice for one occurrence.
    //
    // The interest and fee legs carry the rule id with a NULL due date. The
    // index is NULLS DISTINCT, so they cannot collide, and the rule's page then
    // reports what the repayment actually costs: a €250 instalment that is €244
    // of principal and €6 of interest reads as €250, not €244. The debt-side
    // transfer leg is deliberately left out — attributing both halves of a
    // transfer to the rule would count the same money twice.
    ...(input.recurring && l.id === legs[0].id
      ? { recurringRuleId: input.recurring.ruleId, recurringDueDate: input.recurring.dueDate }
      : input.recurring && l.kind === "standard"
        ? { recurringRuleId: input.recurring.ruleId }
        : {}),
  })

  // Step 1 (recurring only): claim the occurrence.
  //
  // An empty result means the (rule, date) pair is taken — but NOT necessarily
  // that the payment happened. The claim is an inserted ledger row, so a run
  // that died between claiming and committing leaves the pair taken forever and
  // the instalment could never post again. So a conflict is diagnosed rather
  // than trusted: a complete occurrence has an allocation row; a recent
  // incomplete one is another run mid-batch; an old incomplete one is wreckage
  // and is cleared so this run can take over.
  if (input.recurring) {
    const claim = async () =>
      db
        .insert(transactions)
        .values(legValues(legs[0]))
        .onConflictDoNothing({ target: [transactions.recurringRuleId, transactions.recurringDueDate] })
        .returning({ id: transactions.id })

    let claimed = await claim()
    if (claimed.length === 0) {
      const [held] = await db
        .select({ id: transactions.id, createdAt: transactions.createdAt })
        .from(transactions)
        .where(and(eq(transactions.recurringRuleId, input.recurring.ruleId), eq(transactions.recurringDueDate, input.recurring.dueDate)))
      // Gone between the conflict and this read: the other run rolled its own
      // claim back, so try once more before giving up.
      if (!held) {
        claimed = await claim()
        if (claimed.length === 0) return { ok: true, payment: null, skipped: "inflight" }
      } else {
        const [allocation] = await db.select({ id: debtPayments.id }).from(debtPayments).where(eq(debtPayments.transactionId, held.id))
        if (allocation) return { ok: true, payment: null, skipped: "posted" }
        const ageMs = Date.now() - new Date(held.createdAt ?? Date.now()).getTime()
        if (ageMs < STALE_CLAIM_MS) return { ok: true, payment: null, skipped: "inflight" }
        // Wreckage: a leg with no payment behind it. Clear it and take over.
        await db.delete(transactions).where(eq(transactions.id, held.id))
        claimed = await claim()
        if (claimed.length === 0) return { ok: true, payment: null, skipped: "inflight" }
      }
    }
  }

  const paymentId = crypto.randomUUID()
  const now = new Date()
  const rest = input.recurring ? legs.slice(1) : legs
  const batch = [
    ...rest.map((l) => db.insert(transactions).values(legValues(l))),
    // Relative balance updates — one UPDATE per account (same pattern as every money path).
    ...[...shifts].map(([accountId, delta]) =>
      db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${delta.toFixed(2)}::numeric`, updatedBy: userId, updatedAt: now })
        .where(eq(wealthAccounts.id, accountId)),
    ),
    db
      .insert(debtPayments)
      .values({
        id: paymentId,
        organizationId: orgId,
        wealthAccountId: row.account.id,
        transactionId: legs[0].id,
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
      .returning(),
  ]

  // Move the schedule forward: the next due date is the first scheduled date
  // after this payment (paying early still counts for the coming instalment).
  // A debt driven by a recurring rule advances with the RULE instead — the rule
  // is the single source of truth for when the next payment is due, and moving
  // both would skip an instalment.
  if (input.advanceSchedule !== false && row.details.nextDueDate && row.details.paymentFrequency && row.details.paymentFrequency !== "irregular") {
    const freq = row.details.paymentFrequency as PaymentFrequency
    const nextDue = input.date < row.details.nextDueDate ? addPeriods(row.details.nextDueDate, freq, 1) : nextDueAfter(row.details.nextDueDate, freq, input.date)
    batch.push(
      db
        .update(debtDetails)
        .set({
          nextDueDate: nextDue,
          ...(row.details.remainingInstallments != null && row.details.remainingInstallments > 0 ? { remainingInstallments: row.details.remainingInstallments - 1 } : {}),
          updatedAt: now,
        })
        .where(eq(debtDetails.id, row.details.id)) as unknown as (typeof batch)[number],
    )
  }

  let results: unknown[]
  try {
    results = (await dbBatch(batch as unknown as Parameters<typeof dbBatch>[0])) as unknown as unknown[]
  } catch (err) {
    // The claim is already committed and the batch is not. Take the claim back
    // out, or the occurrence is wedged until the stale window passes — and the
    // orphan leg would sit on the paying account as an outgoing transfer that
    // never moved any money.
    if (input.recurring) await db.delete(transactions).where(eq(transactions.id, legs[0].id)).catch(() => {})
    throw err
  }
  const payment = (results[rest.length + shifts.size] as PaymentRow[])[0]

  for (const l of legs) await logAudit({ orgId, entityType: "transaction", entityId: l.id, action: "create", actorId: userId })
  await logAudit({ orgId, entityType: "wealth_account", entityId: row.account.id, action: "update", actorId: userId, changes: { debt_payment: { from: null, to: fromCents(split.total) } } })

  // Interest and fees are ordinary spending in an ordinary category, so they can
  // breach a budget exactly like any other expense — and a €400 interest line
  // the user never typed is precisely the kind they would want to hear about.
  // Principal is a transfer and is correctly invisible to this. Off the response
  // path, so alerting can never fail a payment that already committed.
  for (const l of legs) {
    if (l.kind === "standard" && l.type === "outgoing") {
      void notifyIfBudgetExceeded(orgId, clientId, userId, { category: l.category, date: input.date }).catch(() => {})
    }
  }
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

// ── The recurring repayment that drives a debt ───────────────────────────────
//
// A debt can be repaid by a recurring rule (kind='debt', debt_account_id = the
// debt). When one exists it is the SINGLE SOURCE OF TRUTH for the schedule:
// what is paid, how often, and when next. `debt_details.payment_amount /
// payment_frequency / next_due_date` are then a MIRROR of it, kept in step by
// debtScheduleMirror() below, because the planner, the amortization schedule,
// the month's obligations and the debt-free estimate all read the debt's own
// fields and would otherwise quietly describe a different schedule from the one
// actually taking the money.

/** Active + inactive repayment rules for these debts, newest first. */
export async function loadDebtRules(orgId: string, debtAccountIds: string[]) {
  if (debtAccountIds.length === 0) return []
  return db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.organizationId, orgId), inArray(recurringRules.debtAccountId, debtAccountIds)))
    .orderBy(desc(recurringRules.active), desc(recurringRules.createdAt))
}

export type DebtRuleRow = Awaited<ReturnType<typeof loadDebtRules>>[number]

/** The one rule that currently drives a debt's schedule, or null. Active wins over paused. */
export const drivingRule = <T extends { active: boolean }>(rules: T[]): T | null =>
  rules.find((r) => r.active) ?? rules[0] ?? null

/**
 * The debt_details patch that mirrors a rule's schedule. Returns the fields
 * only — the caller decides whether to issue it alone or inside a batch.
 *
 * A rhythm the debt vocabulary cannot name (every 10 days) mirrors as
 * `irregular`: the amount and the next date are still true, and "irregular" is
 * exactly how the rest of the feature already says "there is no named period
 * here", so the schedule table and the payoff estimate stand down instead of
 * inventing a periods-per-year.
 */
export function debtScheduleMirror(rule: Pick<DebtRuleRow, "amount" | "frequencyUnit" | "frequencyInterval" | "nextDueAt" | "active">) {
  const frequency = recurringToFrequency(rule.frequencyUnit as FrequencyUnit, rule.frequencyInterval)
  return {
    paymentAmount: String(rule.amount),
    paymentFrequency: frequency ?? "irregular",
    nextDueDate: String(rule.nextDueAt).slice(0, 10),
    updatedAt: new Date(),
  }
}

/**
 * Pause or resume every repayment rule on a debt.
 *
 * Resuming RE-ANCHORS the cursor to today rather than letting it catch up. A
 * paused debt is a deliberate holiday from paying, so resuming after six months
 * must not fire six back-dated instalments the user never authorised — that is
 * the opposite of the archived-account case, where the charges really did
 * happen and catching up is the correct repair.
 */
export async function setDebtRulesActive(orgId: string, debtAccountId: string, active: boolean, userId: string, today: string): Promise<void> {
  await db
    .update(recurringRules)
    .set({
      active,
      ...(active ? { nextDueAt: sql`GREATEST(${recurringRules.nextDueAt}, ${today})` } : {}),
      lastError: "",
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(recurringRules.organizationId, orgId), eq(recurringRules.debtAccountId, debtAccountId)))
}

// ── Everything that ever moved on this debt ──────────────────────────────────

export type DebtActivityKind = "opening" | "adjustment" | "borrow" | "payment" | "other"

export type DebtActivityRow = {
  id: string
  date: string
  kind: DebtActivityKind
  description: string
  /** How much the amount owed moved: POSITIVE reduces the debt, negative grows it. */
  principal: number
  interest: number
  fees: number
  other: number
  /** Out of pocket for a payment (principal + the expense legs); the amount received for a borrow. */
  total: number
  counter_account_id: string | null
  counter_account_name: string | null
  group_id: string | null
  transaction_id: string
  payment_id: string | null
  split_source: string | null
  recurring_rule_id: string | null
  is_system: boolean
}

/**
 * Every money event that touched this debt, newest first — not just the
 * repayments. The opening balance, the money when it was borrowed, each
 * repayment with its interest and fees, and every reconciliation are all part
 * of "what happened to this debt", and a screen that shows only the repayments
 * cannot explain the balance it is displaying.
 *
 * One row per ledger GROUP: a repayment's principal transfer and its interest
 * and fee expenses are one event to a person, and reading them as three
 * unrelated lines is how a €500 payment looks like €920 of activity. The split
 * comes from the debt_payments allocation when there is one (authoritative,
 * because it records what the user or the rate actually decided) and is
 * otherwise derived from the sibling legs.
 */
export async function buildDebtActivity(debtAccountId: string, direction: DebtDirection, limit = 200): Promise<DebtActivityRow[]> {
  const own = await db
    .select({ groupId: transactions.groupId, id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.wealthAccountId, debtAccountId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit)

  // An INTEREST-ONLY payment writes nothing on the debt account — there is no
  // principal to transfer — so it would be missing from a list built only from
  // the debt's own legs, even though the user paid real money against this
  // debt. The allocation rows know about it, so they are a second way in.
  const allocationGroups = await db
    .select({ groupId: debtPayments.groupId, transactionId: debtPayments.transactionId })
    .from(debtPayments)
    .innerJoin(transactions, eq(transactions.id, debtPayments.transactionId))
    .where(and(eq(debtPayments.wealthAccountId, debtAccountId), isNull(transactions.deletedAt)))
    .orderBy(desc(debtPayments.date))
    .limit(limit)
  if (own.length === 0 && allocationGroups.length === 0) return []

  const groupIds = [
    ...new Set(
      [...own.map((r) => r.groupId), ...allocationGroups.map((r) => r.groupId)].filter((g): g is string => !!g),
    ),
  ]
  const soloIds = [
    ...new Set([
      ...own.filter((r) => !r.groupId).map((r) => r.id),
      ...allocationGroups.filter((r) => !r.groupId).map((r) => r.transactionId),
    ]),
  ]

  // Both the debt's own legs and their siblings on the paying account — the
  // interest and fee legs never touch the debt account, so a query scoped to it
  // would report a mortgage payment as principal only.
  const legs = await db
    .select({
      id: transactions.id,
      groupId: transactions.groupId,
      accountId: transactions.wealthAccountId,
      accountName: sql<string | null>`coalesce(nullif(${wealthAccounts.nickname}, ''), ${wealthAccounts.bankName})`,
      kind: transactions.kind,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
      category: transactions.category,
      date: transactions.date,
      isSystem: transactions.isSystem,
      recurringRuleId: transactions.recurringRuleId,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .leftJoin(wealthAccounts, eq(wealthAccounts.id, transactions.wealthAccountId))
    .where(
      and(
        isNull(transactions.deletedAt),
        or(
          groupIds.length ? inArray(transactions.groupId, groupIds) : undefined,
          soloIds.length ? inArray(transactions.id, soloIds) : undefined,
        ),
      ),
    )

  const allocations = await db
    .select()
    .from(debtPayments)
    .where(eq(debtPayments.wealthAccountId, debtAccountId))
  const byGroup = new Map(allocations.filter((a) => a.groupId).map((a) => [a.groupId!, a]))
  const byTx = new Map(allocations.map((a) => [a.transactionId, a]))

  type Bucket = { legs: typeof legs }
  const buckets = new Map<string, Bucket>()
  for (const l of legs) {
    const key = l.groupId ?? l.id
    const b = buckets.get(key) ?? { legs: [] }
    b.legs.push(l)
    buckets.set(key, b)
  }

  const rows: DebtActivityRow[] = []
  for (const [key, bucket] of buckets) {
    // An interest-only payment has no leg on the debt account at all; its
    // allocation row is what makes it part of this debt's story, and the
    // anchor leg (on the paying account) carries its date and description.
    const allocation = byGroup.get(key) ?? bucket.legs.map((l) => byTx.get(l.id)).find(Boolean) ?? null
    const debtLeg = bucket.legs.find((l) => l.accountId === debtAccountId) ?? (allocation ? bucket.legs.find((l) => l.id === allocation.transactionId) ?? bucket.legs[0] : null)
    if (!debtLeg) continue
    const onDebt = debtLeg.accountId === debtAccountId
    const counter = bucket.legs.find((l) => l.accountId !== debtAccountId) ?? null

    // Effect on what is owed. A loan's debt shrinks on an INCOMING leg (money
    // arriving at the liability account pays it down); a receivable's claim
    // shrinks on an OUTGOING one.
    // Nothing on the debt account means nothing came off the debt: the payment
    // was all interest. It still belongs here, it just moved no principal.
    const reduces = !onDebt || (direction === "owed" ? debtLeg.type === "incoming" : debtLeg.type === "outgoing")
    const magnitude = onDebt ? num(debtLeg.amount) : 0
    const principal = allocation ? num(allocation.principal) : magnitude
    const signedPrincipal = reduces ? principal : -principal

    const expenseLegs = bucket.legs.filter((l) => l.accountId !== debtAccountId && l.kind === "standard")
    const interest = allocation
      ? num(allocation.interest)
      : expenseLegs.filter((l) => /interest/i.test(l.category ?? "")).reduce((s, l) => s + num(l.amount), 0)
    const fees = allocation
      ? num(allocation.fees)
      : expenseLegs.filter((l) => !/interest/i.test(l.category ?? "")).reduce((s, l) => s + num(l.amount), 0)
    const other = allocation ? num(allocation.other) : 0

    let kind: DebtActivityKind = "other"
    if (allocation && !onDebt) kind = "payment"
    else if (debtLeg.isSystem) kind = /adjust/i.test(debtLeg.category ?? "") ? "adjustment" : "opening"
    else if (debtLeg.kind === "transfer") kind = reduces ? "payment" : "borrow"

    rows.push({
      id: key,
      date: String(debtLeg.date).slice(0, 10),
      kind,
      description: debtLeg.description ?? "",
      principal: Math.round(signedPrincipal * 100) / 100,
      interest,
      fees,
      other,
      total: Math.round((principal + interest + fees + other) * 100) / 100,
      counter_account_id: counter?.accountId ?? null,
      counter_account_name: counter?.accountName ?? null,
      group_id: debtLeg.groupId,
      transaction_id: debtLeg.id,
      payment_id: allocation?.id ?? null,
      split_source: allocation?.splitSource ?? null,
      // The occurrence's recurring keys live on the ANCHOR leg, which is the one
      // on the paying account — so look across the whole group, not just here.
      recurring_rule_id: bucket.legs.find((l) => l.recurringRuleId)?.recurringRuleId ?? null,
      is_system: debtLeg.isSystem,
    })
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}
