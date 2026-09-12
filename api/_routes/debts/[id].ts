import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { debtDetails, recurringRules, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, ensureDefaultClient, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import {
  buildDebtActivity,
  debtScheduleMirror,
  directionOf,
  drivingRule,
  loadDebt,
  loadDebtRules,
  loadPayments,
  scheduleFor,
  serializeDebt,
  setDebtRulesActive,
  type DebtRuleRow,
} from "../../_lib/debts.js"
import { materializeDueRecurring } from "../../_lib/recurring-materialize.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { PAYMENT_FREQUENCIES, type PaymentFrequency } from "../../../src/lib/debt-math.js"
import { frequencyToRecurring, MAX_DEBT_KIND_LENGTH, normalizeDebtKind, recurringToFrequency } from "../../../src/lib/debt-recurring.js"
import { DEBT_LIFECYCLES } from "../../../src/lib/debt-status.js"
import { todayIso, type FrequencyUnit } from "../../../src/lib/recurring.js"
import { isValidCurrency } from "../../../src/lib/currencies.js"

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** The repayment rule in the shape the debt screens read it. */
async function serializeRepayment(orgId: string, rule: DebtRuleRow | null) {
  if (!rule) return null
  const [account] = rule.wealthAccountId
    ? await db
        .select({ name: sql<string>`coalesce(nullif(${wealthAccounts.nickname}, ''), ${wealthAccounts.bankName})`, type: wealthAccounts.type })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, rule.wealthAccountId), eq(wealthAccounts.organizationId, orgId)))
    : [null]
  return {
    id: rule.id,
    name: rule.name,
    active: rule.active,
    amount: Number(rule.amount),
    frequency: recurringToFrequency(rule.frequencyUnit as FrequencyUnit, rule.frequencyInterval),
    frequency_unit: rule.frequencyUnit,
    frequency_interval: rule.frequencyInterval,
    start_date: String(rule.startDate).slice(0, 10),
    end_date: rule.endDate ? String(rule.endDate).slice(0, 10) : null,
    next_due_at: String(rule.nextDueAt).slice(0, 10),
    from_account_id: rule.wealthAccountId,
    from_account_name: account?.name ?? null,
    last_error: rule.lastError ?? "",
  }
}

/**
 * GET    /api/debts/:id — one debt, everything that ever moved on it
 *        (`activity`), its live payment allocations, its amortization schedule
 *        and the recurring repayment that services it.
 * PATCH  /api/debts/:id — edit terms, set the lifecycle (paused / paid off /
 *        refinanced / written off / active), add, change or stop the recurring
 *        repayment, or RECONCILE the balance: a new `current_balance` records a
 *        system Balance Adjustment for the difference — history is never
 *        rewritten.
 * DELETE /api/debts/:id — close (archive) a debt that has history; hard-delete
 *        one that has none (details, payments and repayment rule cascade).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }
  const today = todayIso()

  const row = await loadDebt(orgId, id)
  if (!row) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    // Anything due has to post before this screen reports a balance or a next
    // due date, or the page contradicts the hub that linked to it.
    await materializeDueRecurring(orgId)
    const fresh = (await loadDebt(orgId, id)) ?? row
    const [payments, activity, rules] = await Promise.all([
      loadPayments(orgId, [id], { limit: 200 }),
      buildDebtActivity(id, directionOf(fresh.account.type)),
      loadDebtRules(orgId, [id]),
    ])
    const live = drivingRule(rules)
    return res.json({
      debt: serializeDebt(fresh, today, { repaymentActive: !!live?.active }),
      payments: payments.map(serialize),
      activity,
      schedule: scheduleFor(fresh, today),
      repayment: await serializeRepayment(orgId, live),
    })
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const b = (req.body ?? {}) as Record<string, unknown>
    const num = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === "") return null
      const n = Number(v)
      return Number.isFinite(n) ? n : NaN
    }
    const detailPatch: Partial<typeof debtDetails.$inferInsert> = {}
    const accountPatch: Partial<typeof wealthAccounts.$inferInsert> = {}

    if (typeof b.name === "string") {
      if (!b.name.trim() && !(typeof b.counterparty === "string" ? b.counterparty.trim() : row.details.counterparty)) return res.status(400).json({ error: "name is required" })
      accountPatch.nickname = b.name.trim()
    }
    if (typeof b.counterparty === "string") { detailPatch.counterparty = b.counterparty.trim(); accountPatch.bankName = b.counterparty.trim() || row.account.bankName }
    if (typeof b.icon === "string" && b.icon.trim()) accountPatch.icon = b.icon
    if (typeof b.kind === "string") {
      if (b.kind.trim().length > MAX_DEBT_KIND_LENGTH) return res.status(400).json({ error: `Type must be ${MAX_DEBT_KIND_LENGTH} characters or fewer` })
      detailPatch.kind = normalizeDebtKind(b.kind)
    }
    if (typeof b.currency === "string") {
      const c = b.currency.trim().toUpperCase()
      if (!isValidCurrency(c)) return res.status(400).json({ error: "Unknown currency" })
      detailPatch.currency = c
    }
    const original = num(b.original_amount)
    if (original !== undefined) {
      if (original !== null && (Number.isNaN(original) || original < 0 || amountExceedsLimit(original))) return res.status(400).json({ error: "original_amount is invalid" })
      detailPatch.originalAmount = original == null ? null : original.toFixed(2)
    }
    const rate = num(b.annual_rate_pct)
    if (rate !== undefined) {
      if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 1000)) return res.status(400).json({ error: "annual_rate_pct is invalid" })
      detailPatch.annualRatePct = rate == null ? null : rate.toFixed(4)
    }
    if (b.rate_type !== undefined) detailPatch.rateType = b.rate_type === "fixed" || b.rate_type === "variable" ? b.rate_type : null
    const payment = num(b.payment_amount)
    if (payment !== undefined) {
      if (payment !== null && (Number.isNaN(payment) || payment < 0 || amountExceedsLimit(payment))) return res.status(400).json({ error: "payment_amount is invalid" })
      detailPatch.paymentAmount = payment == null || payment === 0 ? null : payment.toFixed(2)
    }
    if (b.payment_frequency !== undefined) {
      if (b.payment_frequency !== null && !(PAYMENT_FREQUENCIES as readonly string[]).includes(String(b.payment_frequency))) return res.status(400).json({ error: "payment_frequency is invalid" })
      detailPatch.paymentFrequency = (b.payment_frequency as string | null) ?? null
    }
    for (const [key, col] of [["next_due_date", "nextDueDate"], ["start_date", "startDate"], ["maturity_date", "maturityDate"]] as const) {
      if (b[key] !== undefined) {
        if (b[key] !== null && !(typeof b[key] === "string" && ISO.test(b[key] as string))) return res.status(400).json({ error: `${key} must be YYYY-MM-DD` })
        detailPatch[col] = (b[key] as string | null) ?? null
      }
    }
    const installments = num(b.remaining_installments)
    if (installments !== undefined) {
      if (installments !== null && (!Number.isInteger(installments) || installments < 0)) return res.status(400).json({ error: "remaining_installments is invalid" })
      detailPatch.remainingInstallments = installments
    }
    if (typeof b.balance_is_estimate === "boolean") detailPatch.balanceIsEstimate = b.balance_is_estimate
    if (typeof b.notes === "string") detailPatch.notes = b.notes.slice(0, 2000)

    let lifecycleChange: string | null = null
    if (b.lifecycle !== undefined) {
      if (!(DEBT_LIFECYCLES as readonly string[]).includes(String(b.lifecycle))) return res.status(400).json({ error: "lifecycle is invalid" })
      detailPatch.lifecycle = b.lifecycle as string
      detailPatch.closedAt = b.lifecycle === "active" || b.lifecycle === "paused" ? null : new Date()
      lifecycleChange = String(b.lifecycle)
    }
    if (b.refinanced_into_account_id !== undefined) {
      if (b.refinanced_into_account_id === null) detailPatch.refinancedIntoAccountId = null
      else {
        const target = await loadDebt(orgId, String(b.refinanced_into_account_id))
        if (!target || target.account.id === id) return res.status(400).json({ error: "refinanced_into_account_id must be another debt in this workspace" })
        detailPatch.refinancedIntoAccountId = target.account.id
      }
    }

    // ── The recurring repayment ─────────────────────────────────────────────
    const existingRules = await loadDebtRules(orgId, [id])
    const current = drivingRule(existingRules)
    if (b.repayment !== undefined) {
      const applied = await applyRepayment(orgId, userId, id, directionOf(row.account.type), current, b.repayment, today)
      if ("error" in applied) return res.status(400).json({ error: applied.error })
      // The rule is the schedule. Mirroring it here — rather than trusting the
      // three loose fields the same request may also carry — is what stops the
      // planner describing a schedule nobody is paying.
      if (applied.rule) Object.assign(detailPatch, debtScheduleMirror(applied.rule))
    }

    // Reconciliation: the balance the lender shows. Recorded as a system
    // Balance Adjustment for the difference — never by editing past payments.
    const reconcile = num(b.current_balance)
    if (reconcile !== undefined && reconcile !== null) {
      if (Number.isNaN(reconcile) || reconcile < 0 || amountExceedsLimit(reconcile)) return res.status(400).json({ error: "current_balance must be 0 or more" })
      const signedNew = directionOf(row.account.type) === "receivable" ? reconcile : -reconcile
      const delta = Math.round((signedNew - Number(row.account.currentBalance)) * 100) / 100
      if (delta !== 0) {
        const clientId = await ensureDefaultClient(orgId, userId)
        const [tx] = await db
          .insert(transactions)
          .values({
            clientId, wealthAccountId: id, type: delta > 0 ? "incoming" : "outgoing", amount: Math.abs(delta).toFixed(2),
            description: "Balance Adjustment", category: "Adjustment", date: today, isSystem: true, createdBy: userId, updatedBy: userId,
          })
          .returning({ id: transactions.id })
        await db
          .update(wealthAccounts)
          .set({ currentBalance: signedNew.toFixed(2), updatedBy: userId, updatedAt: new Date() })
          .where(eq(wealthAccounts.id, id))
        await logAudit({ orgId, entityType: "transaction", entityId: tx.id, action: "create", actorId: userId })
      }
    }

    if (Object.keys(accountPatch).length) {
      await db.update(wealthAccounts).set({ ...accountPatch, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, id))
    }
    if (Object.keys(detailPatch).length) {
      await db.update(debtDetails).set({ ...detailPatch, updatedAt: new Date() }).where(eq(debtDetails.id, row.details.id))
    }

    // A debt the user pauses, writes off, marks repaid or refinances must stop
    // taking money. Resuming re-anchors the rule to today rather than firing
    // every instalment of the holiday at once (api/_lib/debts.ts).
    if (lifecycleChange) await setDebtRulesActive(orgId, id, lifecycleChange === "active", userId, today)

    const after = (await loadDebt(orgId, id))!
    const changes = diffFields(
      { ...row.details, nickname: row.account.nickname, currentBalance: row.account.currentBalance } as Record<string, unknown>,
      { ...after.details, nickname: after.account.nickname, currentBalance: after.account.currentBalance } as Record<string, unknown>,
      ["nickname", "counterparty", "kind", "currency", "originalAmount", "annualRatePct", "rateType", "paymentAmount", "paymentFrequency", "nextDueDate", "startDate", "maturityDate", "remainingInstallments", "lifecycle", "refinancedIntoAccountId", "notes", "currentBalance"],
    )
    if (Object.keys(changes).length) await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "update", actorId: userId, changes })
    const rules = await loadDebtRules(orgId, [id])
    return res.json({ ...serializeDebt(after, today), repayment: await serializeRepayment(orgId, drivingRule(rules)) })
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [{ total }] = await db
      .select({ total: count() })
      .from(transactions)
      .where(and(eq(transactions.wealthAccountId, id), isNull(transactions.deletedAt)))
    if (total > 0) {
      // Keep the history: close the account (it stays in the "closed" list). Its
      // repayment rule stops with it — a closed debt that kept taking money
      // every month is the worst possible version of this bug.
      await setDebtRulesActive(orgId, id, false, userId, today)
      await db
        .update(wealthAccounts)
        .set({ archivedAt: new Date(), isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, id))
      await db.update(debtDetails).set({ closedAt: sql`coalesce(${debtDetails.closedAt}, now())`, updatedAt: new Date() }).where(eq(debtDetails.id, row.details.id))
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "close", actorId: userId })
      return res.json(serializeDebt((await loadDebt(orgId, id))!, today))
    }
    // details, payments and the repayment rule all cascade off the account.
    await db.delete(wealthAccounts).where(eq(wealthAccounts.id, id))
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}

/**
 * Create, change or stop the recurring repayment on an existing debt.
 *
 * `repayment: null` / `{ enabled: false }` STOPS it rather than deleting it:
 * the occurrences it already posted are real transactions, and a rule the user
 * can see and restart explains them. Deleting the row would leave a history of
 * payments with nothing that says where they came from.
 */
async function applyRepayment(
  orgId: string,
  userId: string,
  debtAccountId: string,
  direction: "owed" | "receivable",
  current: DebtRuleRow | null,
  raw: unknown,
  today: string,
): Promise<{ rule: DebtRuleRow | null } | { error: string }> {
  const off = raw === null || (typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).enabled === false)
  if (off) {
    if (current) {
      await db
        .update(recurringRules)
        .set({ active: false, lastError: "", updatedBy: userId, updatedAt: new Date() })
        .where(eq(recurringRules.id, current.id))
    }
    return { rule: null }
  }
  if (typeof raw !== "object" || raw === null) return { error: "repayment must be an object or null" }
  const r = raw as Record<string, unknown>

  const fromAccountId = typeof r.from_account_id === "string" && r.from_account_id.trim() ? r.from_account_id.trim() : current?.wealthAccountId ?? ""
  if (!fromAccountId) return { error: "Choose the account the repayment comes from" }
  const [acc] = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, fromAccountId), eq(wealthAccounts.organizationId, orgId)))
  // Bank or cash only — see the same guard on POST /api/debts for why a card
  // may pay a loan by hand but must not do it on a schedule.
  if (!acc || acc.archivedAt || (acc.type !== "bank" && acc.type !== "cash")) {
    return { error: "A recurring repayment must come from a bank or cash account" }
  }

  const amount = r.amount === undefined && current ? Number(current.amount) : Number(r.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { error: "The repayment amount must be more than 0" }
  if (amountExceedsLimit(amount)) return { error: "Amount is too large" }

  const frequencyRaw = typeof r.frequency === "string"
    ? r.frequency
    : current
      ? recurringToFrequency(current.frequencyUnit as FrequencyUnit, current.frequencyInterval) ?? "monthly"
      : "monthly"
  const freq = frequencyToRecurring(frequencyRaw as PaymentFrequency)
  if (!freq) return { error: "Choose how often the repayment is made" }

  const startDate = typeof r.start_date === "string" && ISO.test(r.start_date)
    ? r.start_date
    : current
      ? String(current.startDate).slice(0, 10)
      : today
  const endDate = r.end_date === null ? null : typeof r.end_date === "string" && ISO.test(r.end_date) ? r.end_date : current?.endDate ? String(current.endDate).slice(0, 10) : null
  if (endDate && endDate < startDate) return { error: "The repayment cannot end before it starts" }
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 120) : current?.name ?? "Repayment"

  // Editing the schedule re-anchors FORWARD ONLY — the same contract
  // /api/recurring/:id uses. Nothing already posted moves, and no instalment is
  // back-dated into a balance that already accounts for it.
  const scheduleChanged =
    !current ||
    String(current.startDate).slice(0, 10) !== startDate ||
    current.frequencyUnit !== freq.unit ||
    current.frequencyInterval !== freq.interval
  const nextDueAt = scheduleChanged ? (startDate > today ? startDate : today) : String(current.nextDueAt).slice(0, 10)

  if (current) {
    const [updated] = await db
      .update(recurringRules)
      .set({
        name,
        type: direction === "receivable" ? "incoming" : "outgoing",
        amount: amount.toFixed(2),
        wealthAccountId: acc.id,
        frequencyUnit: freq.unit,
        frequencyInterval: freq.interval,
        startDate,
        endDate,
        nextDueAt,
        active: r.active === false ? false : true,
        lastError: "",
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(recurringRules.id, current.id))
      .returning()
    return { rule: updated ?? null }
  }

  const [created] = await db
    .insert(recurringRules)
    .values({
      organizationId: orgId,
      clientId: null,
      kind: "debt",
      debtAccountId,
      wealthAccountId: acc.id,
      toAccountId: null,
      name,
      type: direction === "receivable" ? "incoming" : "outgoing",
      amount: amount.toFixed(2),
      category: "Transfer",
      frequencyUnit: freq.unit,
      frequencyInterval: freq.interval,
      startDate,
      endDate,
      nextDueAt,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  return { rule: created ?? null }
}
