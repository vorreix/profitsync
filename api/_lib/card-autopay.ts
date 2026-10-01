// The card "sync" every card read runs — the lazy, cron-free engine behind
// statements, autopay and card alerts (the same trigger model as recurring
// rules: cheap when nothing is due, correct before anything renders; the
// notification tick also runs it so a card nobody opens still pays on time).
//
//   1. File any statement whose closing date has passed (credit-card.ts
//      ensureStatements) and announce the newest one filed.
//   2. AUTOPAY: for each open credit card with autopay on and a funding bank,
//      pay the NEWEST statement that fell due — a later statement's balance
//      already contains every older unpaid amount (FIFO, docs/credit-cards
//      §2.3), so older due statements are marked superseded, never paid twice
//      (src/lib/cards.ts autopayPlan). The payment is a real bank→card
//      TRANSFER through the same helper the Pay-card sheet uses, dated TODAY
//      (the day the app records it — always after every filed close, so every
//      statement sees it), clamped to what the card owes (autopayAmount).
//   3. Alerts: payment due soon / overdue, utilisation ≥ 90 %, card expiring.
//
// Exactly-once under Neon HTTP (no interactive transactions):
//   • pre-claim SKIPS (funding bank gone, quota, nothing owed) leave the
//     statement untouched — notified once, retried on the next run;
//   • the statement row is CLAIMED with one conditional UPDATE
//     (`… set autopay_status='processing' where … is null returning id`) —
//     only the winner moves money; `remaining` is recomputed AFTER the claim so
//     a manual payment landing in between is respected;
//   • the two legs, both balance updates and the 'paid' mark are ONE atomic
//     batch (wealth-accounts.ts createTransfer `extra`);
//   • a batch error → 'failed' (+ notification, never retried automatically);
//     a 'processing' claim older than STALE_CLAIM_MS with no group is a crash
//     between claim and batch → flipped to 'failed' and notified on the next run.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { and, asc, eq, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { cards, creditCardStatements, wealthAccounts } from "../../src/lib/db/schema.js"
import { autopayAmount, autopayEligible, autopayPlan, cardExpiresSoon, expiryLabel } from "../../src/lib/cards.js"
import { addDays, cardDebt, creditUsage, isLiabilityType, statementView } from "../../src/lib/credit-card.js"
import { todayIso } from "../../src/lib/recurring.js"
import { resolveCardForLeg, sameNativeCurrency } from "./cards.js"
import { ensureStatements, isConfiguredCard, paymentsAfter } from "./credit-card.js"
import { createTransfer } from "./wealth-accounts.js"
import { reportingCurrencyFor } from "./fx-rates.js"
import {
  type AutopayFailureCode,
  notifyAutopayFailed,
  notifyAutopayPaid,
  notifyCardExpiring,
  notifyPaymentDueSoon,
  notifyPaymentOverdue,
  notifyStatementReady,
  notifyUtilizationHigh,
} from "./notify-cards.js"

type CardRow = typeof cards.$inferSelect
type AccountRow = typeof wealthAccounts.$inferSelect
type StatementRow = typeof creditCardStatements.$inferSelect

export const UTILIZATION_ALERT_RATIO = 0.9
export const DUE_SOON_DAYS = 3
/** The stable `autopay_error` (and outcome reason) of a statement autopay refused across currencies — the same code the card routes return. */
export const AUTOPAY_CURRENCY_MISMATCH = "autopay_currency_mismatch"
/** A 'processing' claim older than this with no transfer is a crash between claim and batch. */
export const STALE_CLAIM_MS = 10 * 60 * 1000

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const label = (a: Pick<AccountRow, "nickname" | "bankName">) => a.nickname.trim() || a.bankName

export type AutopayOutcome = { statementId: string; cardId: string; status: "paid" | "skipped" | "failed" | "deferred"; amount: number; reason?: string }

async function markStatement(id: string, patch: Partial<StatementRow>): Promise<void> {
  await db.update(creditCardStatements).set(patch).where(eq(creditCardStatements.id, id))
}

/**
 * Pay one statement. `remaining` is the caller's estimate; it is recomputed
 * after the claim. Returns what happened, or null when another run won the claim.
 */
async function autopayStatement(input: {
  orgId: string
  card: CardRow
  account: AccountRow
  funding: AccountRow | null
  statement: StatementRow
  today: string
  /** The card's identity for notifications, with its own currency. */
  identity: CardRow & { account_bank_name: string; currency: string }
}): Promise<AutopayOutcome | null> {
  const { orgId, card, account, funding, statement, today, identity } = input
  // Money is attributed to the card's owner, never to whoever happened to
  // trigger the read (a viewer's GET must not author transactions).
  const actor = card.createdBy ?? card.updatedBy ?? "system"

  // ── Pre-claim skips: ordinary conditions, retried on the next run ──────────
  // `code` is what the notification translates; `reason` the engine's own
  // words for the outcome/log only; `detail` the rare clause that may reach the
  // user in place of the code's (the plan's quota sentence) — never an engine
  // or validation error, which would surface untranslated in push and mail.
  const deferred = async (code: AutopayFailureCode, notifyKey: string, reason?: string, detail?: string): Promise<AutopayOutcome> => {
    void notifyAutopayFailed({ orgId, card: identity, statementId: statement.id, amount: num(statement.statementBalance), code, detail, dedupeSuffix: notifyKey }).catch(() => {})
    return { statementId: statement.id, cardId: card.id, status: "deferred", amount: 0, reason: reason ?? code }
  }
  if (!funding || funding.archivedAt) return deferred("autopay_funding_missing", "funding")
  // Autopay only ever moves money OUT OF AN ACCOUNT THAT HOLDS SOME. Paying one
  // card with another is a balance transfer: legitimate to record by hand, but
  // never on a schedule — it would compound debt unattended, and refusing it
  // here is what makes a funding cycle impossible without walking the graph (a
  // loop needs two unattended payers). Both write paths already refuse the
  // combination; this is the backstop for a row that predates them.
  if (isLiabilityType(funding.type)) return deferred("autopay_liability", "funding")
  // ...and only from an account in the CARD'S currency: a cross-currency
  // transfer needs the amount that actually arrived, which nobody is here to
  // type. Both write paths refuse the pairing (autopay_currency_mismatch); this
  // is the backstop for a row that predates them. Not a deferral — retrying
  // could never succeed and would release and re-claim on every read — so the
  // statement is marked FAILED with a stable reason before anything is
  // claimed (conditional, so it never overwrites a claim another run holds).
  if (!(await sameNativeCurrency(orgId, funding.currencyCode, account.currencyCode))) {
    const marked = await db
      .update(creditCardStatements)
      .set({ autopayStatus: "failed", autopayAt: new Date(), autopayError: AUTOPAY_CURRENCY_MISMATCH })
      .where(and(eq(creditCardStatements.id, statement.id), isNull(creditCardStatements.autopayStatus)))
      .returning({ id: creditCardStatements.id })
    if (marked.length === 0) return null
    void notifyAutopayFailed({ orgId, card: identity, statementId: statement.id, amount: num(statement.statementBalance), code: AUTOPAY_CURRENCY_MISMATCH }).catch(() => {})
    return { statementId: statement.id, cardId: card.id, status: "failed", amount: 0, reason: AUTOPAY_CURRENCY_MISMATCH }
  }
  // The paying INSTRUMENT, when one was chosen: a frozen or closed debit card,
  // or one whose bank moved, defers (retryable) rather than paying unattributed.
  let fromCardId: string | null = null
  if (card.fundingCardId) {
    const resolved = await resolveCardForLeg(orgId, card.fundingCardId, funding.id, { allowFrozen: true })
    if (!resolved.ok) return deferred("autopay_funding_card", "funding", `the card that pays this one can't be used — ${resolved.error.toLowerCase()}`)
    fromCardId = resolved.card.id
  }
  // (The free plan's per-client transaction quota is checked inside
  // createTransfer; a 402 there releases the claim below and defers.)

  // ── Claim ──────────────────────────────────────────────────────────────────
  const claimed = await db
    .update(creditCardStatements)
    .set({ autopayStatus: "processing", autopayAt: new Date(), autopayError: null })
    .where(and(eq(creditCardStatements.id, statement.id), isNull(creditCardStatements.autopayStatus)))
    .returning({ id: creditCardStatements.id })
  if (claimed.length === 0) return null

  // Recompute AFTER the claim: a manual payment recorded a second ago counts.
  const [fresh] = await db.select().from(wealthAccounts).where(eq(wealthAccounts.id, account.id))
  const paid = await paymentsAfter(account.id, statement.closingDate)
  const view = statementView({ statementBalance: statement.statementBalance, paymentsSinceClose: paid, dueDate: statement.dueDate, today })
  const amount = autopayAmount(view.remaining, cardDebt(fresh?.currentBalance ?? account.currentBalance))
  if (amount <= 0) {
    await markStatement(statement.id, { autopayStatus: "skipped", autopayError: "nothing left to pay" })
    return { statementId: statement.id, cardId: card.id, status: "skipped", amount: 0 }
  }

  // ── Pay: legs + balances + the 'paid' mark, atomically ────────────────────
  try {
    const result = await createTransfer(orgId, actor, {
      fromAccountId: funding.id,
      toAccountId: account.id,
      fromCardId,
      amount,
      date: today,
      descriptions: {
        out: `Autopay: card payment to ${label(account)} (statement due ${statement.dueDate})`,
        in: `Autopay: card payment from ${label(funding)} (statement due ${statement.dueDate})`,
      },
      extra: [
        db
          .update(creditCardStatements)
          .set({ autopayStatus: "paid", autopayAt: new Date() })
          .where(eq(creditCardStatements.id, statement.id)),
      ],
    })
    if (!result.ok) {
      // A quota 402 or validation 400 before any money moved: release the claim
      // so the next run (after an upgrade / fix) tries again, and say why once.
      const reason = typeof result.body.reason === "string" ? result.body.reason : typeof result.body.error === "string" ? result.body.error : "the payment could not be recorded"
      await markStatement(statement.id, { autopayStatus: null, autopayAt: null, autopayError: reason })
      return result.status === 402
        ? deferred("autopay_quota", "quota", reason, reason)
        : deferred("autopay_not_recorded", "quota", reason)
    }
    await markStatement(statement.id, { autopayGroupId: result.groupId })
    void notifyAutopayPaid({ orgId, card: identity, statementId: statement.id, amount, fromName: label(funding) }).catch(() => {})
    return { statementId: statement.id, cardId: card.id, status: "paid", amount }
  } catch (err) {
    // The batch threw: nothing landed (it is atomic). Record the failure and
    // hand the statement to the user — retrying an unknown failure is how
    // money gets moved twice.
    console.error("[cards] autopay batch failed", statement.id, err)
    const reason = err instanceof Error ? err.message.slice(0, 300) : "the payment could not be recorded"
    await markStatement(statement.id, { autopayStatus: "failed", autopayError: reason }).catch(() => {})
    // The raw error stays in the row and the log; the user gets the plain clause.
    void notifyAutopayFailed({ orgId, card: identity, statementId: statement.id, amount, code: "autopay_not_recorded" }).catch(() => {})
    return { statementId: statement.id, cardId: card.id, status: "failed", amount, reason }
  }
}

export type SyncResult = { filed: number; autopay: AutopayOutcome[] }

/** Anything still 'processing' long after its claim never finished — the batch never ran. */
async function reconcileStaleClaims(orgId: string, cardsById: Map<string, { card: CardRow; account: AccountRow }>, currencyOf: (a: AccountRow) => Promise<string>): Promise<void> {
  const stale = await db
    .select()
    .from(creditCardStatements)
    .where(and(
      eq(creditCardStatements.organizationId, orgId),
      eq(creditCardStatements.autopayStatus, "processing"),
      isNull(creditCardStatements.autopayGroupId),
      lt(creditCardStatements.autopayAt, new Date(Date.now() - STALE_CLAIM_MS)),
    ))
  for (const s of stale) {
    await markStatement(s.id, { autopayStatus: "failed", autopayError: "the payment was interrupted before it was recorded" })
    const owner = [...cardsById.values()].find((c) => c.account.id === s.wealthAccountId)
    if (owner) {
      const card = { ...owner.card, account_bank_name: owner.account.bankName, currency: await currencyOf(owner.account) }
      void notifyAutopayFailed({ orgId, card, statementId: s.id, amount: num(s.statementBalance), code: "autopay_interrupted" }).catch(() => {})
    }
  }
}

/**
 * Run the card sync for an org. Safe to call on every read: every step is
 * idempotent and the common case (nothing closed, nothing due) is a couple of
 * indexed selects. Never throws — callers `void syncCards(orgId).catch(…)` or
 * await it before rendering; a failure here must not break a page.
 */
export async function syncCards(orgId: string, today = todayIso()): Promise<SyncResult> {
  const result: SyncResult = { filed: 0, autopay: [] }

  // Every open credit card with its liability account.
  const rows = await db
    .select({ card: cards, account: wealthAccounts })
    .from(cards)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, cards.accountId))
    .where(and(eq(cards.organizationId, orgId), eq(cards.kind, "credit"), ne(cards.status, "closed"), isNull(wealthAccounts.archivedAt)))
    .orderBy(asc(cards.createdAt))

  if (rows.length > 0) {
    // A card's notifications speak its own currency; a legacy NULL account is
    // the reporting currency, looked up at most once per sync. Fail-soft (to
    // the lookup's own default): only the wording depends on it, and a cached
    // rejection must never stop statements or autopay for the rest of the run.
    let reporting: Promise<string> | null = null
    const currencyOf = async (a: AccountRow) => a.currencyCode ?? (await (reporting ??= reportingCurrencyFor(orgId).catch(() => "USD")))
    const cardsById = new Map(rows.map((r) => [r.card.id, r]))
    await reconcileStaleClaims(orgId, cardsById, currencyOf).catch(() => {})

    const fundingIds = [...new Set(rows.map((r) => r.card.fundingAccountId).filter((x): x is string => !!x))]
    const fundingRows = fundingIds.length
      ? await db.select().from(wealthAccounts).where(and(eq(wealthAccounts.organizationId, orgId), inArray(wealthAccounts.id, fundingIds)))
      : []
    const fundingById = new Map(fundingRows.map((f) => [f.id, f]))

    for (const { card, account } of rows) {
      try {
        const identity = { ...card, account_bank_name: account.bankName, currency: await currencyOf(account) }

        // 1. Statements — file, and announce only the NEWEST one this run filed
        //    (a long catch-up must not deliver a burst).
        const filed = await ensureStatements(account, today)
        result.filed += filed.length
        const newest = filed[filed.length - 1]
        if (newest && num(newest.statementBalance) > 0) {
          void notifyStatementReady({ orgId, card: identity, statementId: newest.id, balance: num(newest.statementBalance), dueDate: newest.dueDate }).catch(() => {})
        }
        if (!isConfiguredCard(account)) continue

        // Statements that are due, due soon, or still open for autopay.
        const statements = await db
          .select()
          .from(creditCardStatements)
          .where(and(
            eq(creditCardStatements.wealthAccountId, account.id),
            lte(creditCardStatements.dueDate, addDays(today, DUE_SOON_DAYS)),
          ))
          .orderBy(asc(creditCardStatements.dueDate))

        const views = []
        for (const s of statements) {
          const paid = await paymentsAfter(account.id, s.closingDate)
          views.push({ row: s, view: statementView({ statementBalance: s.statementBalance, paymentsSinceClose: paid, dueDate: s.dueDate, today }) })
        }
        const cardInput = { autopay: card.autopay, autopay_since: card.autopaySince, funding_account_id: card.fundingAccountId, status: card.status }
        const stmtInputs = views.map(({ row, view }) => ({ id: row.id, due_date: row.dueDate, remaining: view.remaining, autopay_status: row.autopayStatus }))

        // 2. Autopay — the newest due statement pays; older due ones are superseded.
        const plan = autopayPlan(cardInput, stmtInputs, today)
        for (const older of plan.supersede) {
          await db
            .update(creditCardStatements)
            .set({ autopayStatus: "skipped", autopayAt: new Date(), autopayError: "superseded by a newer statement" })
            .where(and(eq(creditCardStatements.id, older.id), isNull(creditCardStatements.autopayStatus)))
        }
        let paidNow: string | null = null
        if (plan.pay) {
          const row = statements.find((s) => s.id === plan.pay!.id)!
          const outcome = await autopayStatement({
            orgId,
            card,
            account,
            funding: card.fundingAccountId ? (fundingById.get(card.fundingAccountId) ?? null) : null,
            statement: row,
            today,
            identity,
          })
          if (outcome) result.autopay.push(outcome)
          if (outcome?.status === "paid") paidNow = row.id
        }

        // 3a. Due soon / overdue — only while something is still owed, and never
        //     for a statement autopay is about to cover.
        for (const { row, view } of views) {
          if (row.id === paidNow || view.remaining <= 0) continue
          const covered = autopayEligible(cardInput, { id: row.id, due_date: row.dueDate, remaining: view.remaining, autopay_status: row.autopayStatus })
          if (view.status === "overdue") {
            void notifyPaymentOverdue({ orgId, card: identity, statementId: row.id, remaining: view.remaining, dueDate: row.dueDate }).catch(() => {})
          } else if (!covered && view.daysToDue >= 0 && view.daysToDue <= DUE_SOON_DAYS) {
            void notifyPaymentDueSoon({ orgId, card: identity, statementId: row.id, remaining: view.remaining, dueDate: row.dueDate, daysToDue: view.daysToDue }).catch(() => {})
          }
        }

        // 3b. Utilisation — once per open cycle (keyed by the latest close, or
        //     the card's creation when nothing has closed yet).
        const usage = creditUsage(account.creditLimit, account.currentBalance)
        if (usage.utilization !== null && usage.utilization >= UTILIZATION_ALERT_RATIO && usage.available !== null) {
          const [latest] = await db
            .select({ closingDate: creditCardStatements.closingDate })
            .from(creditCardStatements)
            .where(eq(creditCardStatements.wealthAccountId, account.id))
            .orderBy(sql`${creditCardStatements.closingDate} desc`)
            .limit(1)
          const cycleStart = latest?.closingDate ?? (account.createdAt ? account.createdAt.toISOString().slice(0, 10) : today)
          void notifyUtilizationHigh({ orgId, card: identity, cycleStart, utilization: usage.utilization, available: usage.available }).catch(() => {})
        }

        // 3c. Expiring within 30 days.
        if (cardExpiresSoon(card.expiryMonth, card.expiryYear, today)) {
          void notifyCardExpiring({ orgId, card: identity, expiry: expiryLabel(card.expiryMonth, card.expiryYear) }).catch(() => {})
        }
      } catch (err) {
        // One broken card must not stop the others (or the page) — but say so.
        console.error("[cards] sync failed for card", card.id, err)
      }
    }
  }

  // Debit cards only have an expiry to watch.
  const debit = await db
    .select({ card: cards, bankName: wealthAccounts.bankName })
    .from(cards)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, cards.accountId))
    .where(and(eq(cards.organizationId, orgId), eq(cards.kind, "debit"), ne(cards.status, "closed"), isNull(wealthAccounts.archivedAt)))
  for (const { card, bankName } of debit) {
    if (cardExpiresSoon(card.expiryMonth, card.expiryYear, today)) {
      void notifyCardExpiring({ orgId, card: { ...card, account_bank_name: bankName }, expiry: expiryLabel(card.expiryMonth, card.expiryYear) }).catch(() => {})
    }
  }

  return result
}
