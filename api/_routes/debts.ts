import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, max, sql } from "drizzle-orm"
import { db, dbBatch } from "../../src/lib/db/index.js"
import { debtDetails, organizations, recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth } from "../_lib/auth.js"
import { checkTransactionQuota } from "../_lib/quota.js"
import { logAudit } from "../_lib/audit.js"
import { resolveLogoColumns } from "../_lib/bank-brand.js"
import { buildDebtsOverview, loadDebt, loadDebtRules, serializeDebt } from "../_lib/debts.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import { PAYMENT_FREQUENCIES, type PaymentFrequency } from "../../src/lib/debt-math.js"
import { frequencyToRecurring, MAX_DEBT_KIND_LENGTH, normalizeDebtKind } from "../../src/lib/debt-recurring.js"
import { todayIso } from "../../src/lib/recurring.js"
import { isValidCurrency } from "../../src/lib/currencies.js"

const ISO = /^\d{4}-\d{2}-\d{2}$/
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * GET  /api/debts — the Debt Hub: every open debt (I owe) and receivable (owed
 *      to me) with derived status/progress/estimate, this month's obligations,
 *      the next payment, insights, and the next 3 months of scheduled payments.
 *      Materialises due repayments first, so the balances it reports are the
 *      balances after everything that should already have been paid (hence
 *      ALWAYS_FETCH in src/lib/api-cache.ts).
 * POST /api/debts — create a debt, and optionally the RECURRING REPAYMENT that
 *      services it, in ONE atomic batch. The money side is recorded exactly
 *      once: either the amount already owed becomes a system Opening Balance on
 *      the new debt account (nothing else moves), or — when the borrowed money
 *      is being received now — a TRANSFER debt → bank account (bank +, debt −;
 *      never income).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId))
  const orgCurrency = org?.currency ?? "USD"

  if (req.method === "GET") {
    // A debt's balance is only true once everything due has posted. Without this
    // the hub would show last month's figure until some other screen happened to
    // run the materializer.
    await materializeDueRecurring(orgId)
    return res.json(await buildDebtsOverview(orgId, orgCurrency))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const b = (req.body ?? {}) as Record<string, unknown>
    const direction = b.direction === "receivable" ? "receivable" : "owed"
    const name = String(b.name ?? "").trim()
    const counterparty = String(b.counterparty ?? "").trim()
    if (!name && !counterparty) return res.status(400).json({ error: "Give the debt a name or say who it is with" })
    // The kind is a LABEL, not an enum: people have arrangements no fixed list
    // covers. A suggestion is stored as its key so it stays translated; anything
    // else is kept exactly as typed (src/lib/debt-recurring.ts).
    if (typeof b.kind === "string" && b.kind.trim().length > MAX_DEBT_KIND_LENGTH) {
      return res.status(400).json({ error: `Type must be ${MAX_DEBT_KIND_LENGTH} characters or fewer` })
    }
    const kind = b.kind === undefined ? (direction === "receivable" ? "informal" : "other") : normalizeDebtKind(b.kind)
    const currency = typeof b.currency === "string" && b.currency.trim() ? b.currency.trim().toUpperCase() : orgCurrency
    if (!isValidCurrency(currency)) return res.status(400).json({ error: "Unknown currency" })

    const balance = num(b.current_balance)
    if (balance === null || Number.isNaN(balance) || balance < 0) return res.status(400).json({ error: "current_balance must be 0 or more" })
    if (amountExceedsLimit(balance)) return res.status(400).json({ error: "Amount is too large" })
    const original = num(b.original_amount)
    if (original !== null && (Number.isNaN(original) || original < 0 || amountExceedsLimit(original))) return res.status(400).json({ error: "original_amount is invalid" })
    const rate = num(b.annual_rate_pct)
    if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 1000)) return res.status(400).json({ error: "annual_rate_pct is invalid" })
    const rateType = b.rate_type === "fixed" || b.rate_type === "variable" ? b.rate_type : null
    const startDate = typeof b.start_date === "string" && ISO.test(b.start_date) ? b.start_date : null
    const maturity = typeof b.maturity_date === "string" && ISO.test(b.maturity_date) ? b.maturity_date : null
    const installments = num(b.remaining_installments)
    if (installments !== null && (!Number.isInteger(installments) || installments < 0)) return res.status(400).json({ error: "remaining_installments is invalid" })
    const notes = String(b.notes ?? "").slice(0, 2000)
    const isEstimate = b.balance_is_estimate === true

    // ── The recurring repayment (optional) ──────────────────────────────────
    // When present it becomes the debt's schedule: payment_amount /
    // payment_frequency / next_due_date mirror the rule, so the planner and the
    // payoff estimate describe the schedule that actually takes the money.
    const repayment = parseRepayment(b.repayment)
    if (repayment && "error" in repayment) return res.status(400).json({ error: repayment.error })

    let payment = num(b.payment_amount)
    if (payment !== null && (Number.isNaN(payment) || payment < 0 || amountExceedsLimit(payment))) return res.status(400).json({ error: "payment_amount is invalid" })
    let frequency: PaymentFrequency | null =
      typeof b.payment_frequency === "string" && (PAYMENT_FREQUENCIES as readonly string[]).includes(b.payment_frequency)
        ? (b.payment_frequency as PaymentFrequency)
        : payment
          ? "monthly"
          : null
    let nextDue = typeof b.next_due_date === "string" && ISO.test(b.next_due_date) ? b.next_due_date : null

    const today = todayIso()
    // The cursor never starts in the past. A back-dated first payment would
    // catch up on the spot — posting repayments the user has, by definition,
    // already accounted for in the balance they just typed — so the anchor keeps
    // the day of the month while the first occurrence lands on or after today.
    const ruleCursor = repayment ? (repayment.startDate > today ? repayment.startDate : today) : null
    if (repayment) {
      payment = repayment.amount
      frequency = repayment.frequency
      nextDue = ruleCursor
    }

    // Paying account: must be somewhere money can actually come from.
    let payFrom: typeof wealthAccounts.$inferSelect | null = null
    if (repayment) {
      const [acc] = await db
        .select()
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, repayment.fromAccountId), eq(wealthAccounts.organizationId, orgId)))
      // Bank or cash only. A credit card CAN pay a loan by hand — it is a real,
      // expensive thing people do — but scheduling it every month moves debt
      // from one place to another forever with no cash ever leaving, and the
      // balance that grows is the one nobody is looking at.
      if (!acc || acc.archivedAt || acc.type !== "bank" && acc.type !== "cash") {
        return res.status(400).json({ error: "A recurring repayment must come from a bank or cash account" })
      }
      payFrom = acc
    }

    // Optional: some or all of the money is landing in a real account right now.
    //
    // PARTIAL is the normal case, not an edge case. You borrow 10,000 for a car,
    // 6,000 reaches your account and the dealer is paid the rest directly; you
    // owe 10,000 either way. So the amount received is recorded as a TRANSFER
    // (bank +6,000, debt −6,000) and the remainder as a system Opening Balance
    // on the debt (−4,000). The two always add up to what is owed, and nothing
    // is ever counted as income.
    const disbursementAccountId = typeof b.disbursement_account_id === "string" ? b.disbursement_account_id : null
    let disbursement: typeof wealthAccounts.$inferSelect | null = null
    let received = 0
    if (disbursementAccountId) {
      const [acc] = await db
        .select()
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, disbursementAccountId), eq(wealthAccounts.organizationId, orgId)))
      if (!acc || acc.archivedAt || acc.type === "space" || acc.type === "loan" || acc.type === "receivable") {
        return res.status(400).json({ error: "Choose an active bank or cash account to receive the money" })
      }
      const asked = num(b.disbursement_amount)
      if (asked !== null && Number.isNaN(asked)) return res.status(400).json({ error: "disbursement_amount is invalid" })
      received = Math.round((asked ?? balance) * 100) / 100
      if (received <= 0) return res.status(400).json({ error: "The amount arriving must be more than 0" })
      if (received > balance) return res.status(400).json({ error: "The amount arriving cannot be more than the debt itself" })
      disbursement = acc
    }
    // What the ledger has no movement for: the part that was already owed before
    // this workspace ever saw it.
    const openingPart = Math.round((balance - received) * 100) / 100

    const type = direction === "receivable" ? "receivable" : "loan"
    const signed = direction === "receivable" ? balance : -balance
    const brandDomain = typeof b.brand_domain === "string" ? b.brand_domain : ""
    const logoUrl = typeof b.logo_url === "string" ? b.logo_url : ""
    const logo = brandDomain || logoUrl ? await resolveLogoColumns(brandDomain, logoUrl) : null
    const [{ maxPos }] = await db.select({ maxPos: max(wealthAccounts.position) }).from(wealthAccounts).where(eq(wealthAccounts.organizationId, orgId))
    const clientId = balance > 0 ? await ensureDefaultClient(orgId, userId) : null
    // The disbursement legs are ordinary, non-system transactions on the anchor
    // client, so they count against the free plan exactly like any other. Every
    // other create path checks this; skipping it here let a workspace drift
    // past its limit, and then the repayment rule could never post.
    if (clientId && disbursement && received > 0) {
      const quota = await checkTransactionQuota(orgId, clientId)
      if (!quota.allowed) return res.status(403).json(quota)
    }

    // Everything below lands in ONE batch. The ids are generated here rather
    // than by the database precisely so that can be true: neon-http has no
    // interactive transactions, so nothing may depend on reading back an
    // earlier statement. A half-created debt — an account with no terms, or
    // terms with no repayment rule — is exactly what the user asked not to be
    // possible.
    const accountId = crypto.randomUUID()
    const ruleId = repayment ? crypto.randomUUID() : null
    const now = new Date()

    const batch: unknown[] = [
      db.insert(wealthAccounts).values({
        id: accountId,
        organizationId: orgId,
        type,
        bankName: counterparty || name,
        nickname: name,
        // Only the part with no ledger movement behind it is an opening balance;
        // whatever arrives is defined by the transfer legs below.
        openingBalance: (direction === "receivable" ? openingPart : -openingPart).toFixed(2),
        currentBalance: signed.toFixed(2),
        icon: typeof b.icon === "string" && b.icon ? b.icon : direction === "receivable" ? "custom" : "bank",
        brandDomain,
        position: (maxPos ?? -1) + 1,
        ...(logo ? { logoUrl: logo.logoUrl, logoData: logo.logoData } : {}),
        createdBy: userId,
        updatedBy: userId,
      }),
      db.insert(debtDetails).values({
        organizationId: orgId,
        wealthAccountId: accountId,
        kind,
        counterparty,
        currency,
        originalAmount: original == null ? (balance > 0 ? balance.toFixed(2) : null) : original.toFixed(2),
        annualRatePct: rate == null ? null : rate.toFixed(4),
        rateType,
        paymentAmount: payment == null || payment === 0 ? null : payment.toFixed(2),
        paymentFrequency: frequency,
        nextDueDate: nextDue,
        startDate,
        maturityDate: maturity,
        remainingInstallments: installments,
        balanceIsEstimate: isEstimate,
        notes,
        createdBy: userId,
      }),
    ]

    const legIds: string[] = []
    if (balance > 0 && clientId) {
      if (openingPart > 0) {
        // Already owed before today: a balance-defining system row (not income,
        // not expense). With a partial disbursement this is only the remainder.
        const id = crypto.randomUUID()
        legIds.push(id)
        batch.push(
          db.insert(transactions).values({
            id, clientId, wealthAccountId: accountId, type: direction === "owed" ? "outgoing" : "incoming",
            amount: openingPart.toFixed(2), description: "Opening Balance", category: "Opening Balance", date: today,
            isSystem: true, createdBy: userId, updatedBy: userId,
          }),
        )
      }
      if (disbursement && received > 0) {
        // Borrowing: a TRANSFER debt → bank (bank +X, debt −X, income 0).
        const groupId = crypto.randomUUID()
        const legs = direction === "owed"
          ? [
              { accountId, type: "outgoing" as const, description: `Borrowed — paid out to ${disbursement.nickname.trim() || disbursement.bankName}` },
              { accountId: disbursement.id, type: "incoming" as const, description: `Borrowed from ${counterparty || name}` },
            ]
          : [
              { accountId: disbursement.id, type: "outgoing" as const, description: `Lent to ${counterparty || name}` },
              { accountId, type: "incoming" as const, description: `Lent — from ${disbursement.nickname.trim() || disbursement.bankName}` },
            ]
        for (const leg of legs) {
          const id = crypto.randomUUID()
          legIds.push(id)
          batch.push(
            db.insert(transactions).values({
              id, clientId, wealthAccountId: leg.accountId, groupId, kind: "transfer", type: leg.type,
              amount: received.toFixed(2), description: leg.description, category: "Transfer", date: startDate ?? today,
              createdBy: userId, updatedBy: userId,
            }),
          )
        }
        // Only the OTHER account needs moving: the debt account was inserted at
        // its post-transfer balance already.
        const delta = direction === "owed" ? received : -received
        batch.push(
          db
            .update(wealthAccounts)
            .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${delta.toFixed(2)}::numeric`, updatedBy: userId, updatedAt: now })
            .where(eq(wealthAccounts.id, disbursement.id)),
        )
      }
    }

    if (repayment && ruleId && payFrom && ruleCursor) {
      const freq = frequencyToRecurring(repayment.frequency)!
      batch.push(
        db.insert(recurringRules).values({
          id: ruleId,
          organizationId: orgId,
          // Debt repayments anchor to the org's default client at materialize time.
          clientId: null,
          kind: "debt",
          debtAccountId: accountId,
          // The BANK, not the debt: this is the account whose cash flow the
          // upcoming-payments projection and the shortfall warnings care about.
          wealthAccountId: payFrom.id,
          toAccountId: null,
          name: repayment.name || (direction === "receivable" ? `Repayment from ${name || counterparty}` : `Repayment — ${name || counterparty}`),
          // What the money does to the USER: a loan instalment leaves, a
          // receivable's instalment arrives.
          type: direction === "receivable" ? "incoming" : "outgoing",
          amount: repayment.amount.toFixed(2),
          category: "Transfer",
          frequencyUnit: freq.unit,
          frequencyInterval: freq.interval,
          startDate: repayment.startDate,
          endDate: repayment.endDate,
          nextDueAt: ruleCursor,
          createdBy: userId,
          updatedBy: userId,
        }),
      )
    }

    await dbBatch(batch as unknown as Parameters<typeof dbBatch>[0])

    for (const id of legIds) await logAudit({ orgId, entityType: "transaction", entityId: id, action: "create", actorId: userId })
    await logAudit({ orgId, entityType: "wealth_account", entityId: accountId, action: "create", actorId: userId })

    // A repayment starting today is due today — post it before answering so the
    // screen the user lands on is already correct.
    if (ruleId && ruleCursor === today) await materializeDueRecurring(orgId)

    const row = await loadDebt(orgId, accountId)
    const rules = await loadDebtRules(orgId, [accountId])
    return res.status(201).json(row ? { ...serializeDebt(row, todayIso()), repayment_rule_id: rules[0]?.id ?? null } : { id: accountId })
  }

  return res.status(405).json({ error: "Method not allowed" })
}

type ParsedRepayment = {
  fromAccountId: string
  amount: number
  frequency: Exclude<PaymentFrequency, "irregular">
  startDate: string
  endDate: string | null
  name: string
}

/**
 * The optional "set up a recurring repayment" block. Returns null when the user
 * is tracking the debt by hand, an `{ error }` when the block is present but
 * unusable — never a half-configured rule, because a repayment that silently
 * failed to be created is money that silently never moves.
 */
function parseRepayment(raw: unknown): ParsedRepayment | { error: string } | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.enabled === false) return null
  const fromAccountId = typeof r.from_account_id === "string" ? r.from_account_id.trim() : ""
  if (!fromAccountId) return { error: "Choose the account the repayment comes from" }
  const amount = Number(r.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { error: "The repayment amount must be more than 0" }
  if (amountExceedsLimit(amount)) return { error: "Amount is too large" }
  const frequency = typeof r.frequency === "string" ? r.frequency : "monthly"
  if (!frequencyToRecurring(frequency as PaymentFrequency)) return { error: "Choose how often the repayment is made" }
  const startDate = typeof r.start_date === "string" && ISO.test(r.start_date) ? r.start_date : ""
  if (!startDate) return { error: "start_date must be YYYY-MM-DD" }
  const endDate = typeof r.end_date === "string" && ISO.test(r.end_date) ? r.end_date : null
  if (endDate && endDate < startDate) return { error: "The repayment cannot end before it starts" }
  return {
    fromAccountId,
    amount,
    frequency: frequency as Exclude<PaymentFrequency, "irregular">,
    startDate,
    endDate,
    name: typeof r.name === "string" ? r.name.trim().slice(0, 120) : "",
  }
}
