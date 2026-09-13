// Materializing a RECURRING DEBT REPAYMENT (recurring_rules.kind = 'debt').
//
// A debt repayment is neither an ordinary recurring expense nor a Space
// auto-save, which is why it needs its own path rather than another flag on the
// transfer branch:
//
//   • It SPLITS. Part of a mortgage instalment repays principal (a transfer —
//     never spending, net worth unchanged) and part is interest and fees (real
//     expenses on the paying account). Posted as a plain transfer, a €1,200
//     instalment would pay down €1,200 of a loan that only fell by €800, and
//     the €400 of interest would never appear as money spent.
//   • The split is recomputed from the LIVE balance every occurrence, so it
//     tracks a real amortization by itself: interest shrinks and principal
//     grows month after month without anything being stored.
//   • The LAST instalment is capped at the payoff figure. A rule paying €500
//     against €120 owed must move €120 plus that period's interest — uncapped,
//     the balance sails past zero into credit and every screen reports "nothing
//     owed" while the money is simply gone from view.
//
// Idempotency is unchanged from every other recurring money path: the first leg
// carries (recurring_rule_id, recurring_due_date) and is inserted with ON
// CONFLICT DO NOTHING, and nothing else is written unless that insert returned a
// row (api/_lib/debts.ts recordDebtPayment).

import { and, eq, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { debtDetails, recurringRules, wealthAccounts } from "../../src/lib/db/schema.js"
import { fromCents, toCents } from "../../src/lib/debt-math.js"
import { linkRefusal, payoffCappedAmount, periodsPerYearForRule, type LinkRefusal } from "../../src/lib/debt-recurring.js"
import { debtScheduleMirror, directionOf, loadDebt, recordDebtPayment, toDebtLike } from "./debts.js"
import type { FrequencyUnit } from "../../src/lib/recurring.js"

type RuleRow = typeof recurringRules.$inferSelect

export type DebtOccurrenceOutcome =
  | {
      ok: true
      created: number
      fullyRepaid: boolean
      /**
       * Another materializer is mid-batch on one of these occurrences. The
       * caller must leave the cursor where it is: advancing past occurrences
       * this run did not post, and the other run may not finish, loses them.
       */
      hold?: boolean
    }
  | { ok: false; error: string }

/**
 * Post every due occurrence of one debt-repayment rule.
 *
 * Returns `ok: false` to mean "pause this rule where it stands": the caller
 * records the reason on the rule and does NOT advance its cursor, so the
 * occurrence fires again once whatever blocked it is fixed. That is the same
 * contract the archived-account and quota guards already use.
 */
export async function postDebtOccurrences(orgId: string, rule: RuleRow, due: string[]): Promise<DebtOccurrenceOutcome> {
  if (!rule.debtAccountId) return { ok: false, error: "This repayment is not linked to a debt any more" }
  if (!rule.wealthAccountId) return { ok: false, error: "Choose the account this repayment is paid from" }

  let row = await loadDebt(orgId, rule.debtAccountId)
  if (!row) return { ok: false, error: "The debt this repays no longer exists" }
  if (row.account.archivedAt) return { ok: false, error: "This debt is closed — reopen it to keep paying" }
  // A debt the user paused, wrote off or marked repaid must not keep taking
  // money. Pausing the debt also deactivates its rules (api/_routes/debts/[id]),
  // so reaching this is belt and braces.
  if (row.details.lifecycle !== "active") return { ok: false, error: "This debt is not active" }

  // The rhythm ACTUALLY taking the money. The debt's own payment_frequency is a
  // mirror that can only name five rhythms, so a rule running every 10 days
  // mirrors as "irregular" and every interest calculation downstream would fall
  // back to a whole month — booking roughly two thirds of each instalment's
  // principal as spending.
  const ppy = periodsPerYearForRule(rule.frequencyUnit as FrequencyUnit, rule.frequencyInterval)

  let created = 0
  for (const dueDate of due) {
    const like = toDebtLike(row)
    const amount = payoffCappedAmount({
      scheduled: toCents(rule.amount),
      outstanding: like.owed,
      annualRatePct: like.annualRatePct,
      frequency: like.frequency,
      periodsPerYear: ppy,
    })
    // Nothing left to pay: stop here and let the caller retire the rule. The
    // occurrences already posted still count, and the cursor still advances.
    if (amount <= 0) return { ok: true, created, fullyRepaid: true }

    const result = await recordDebtPayment(orgId, rule.createdBy ?? "system", row, {
      counterAccountId: rule.wealthAccountId,
      date: dueDate,
      total: fromCents(amount),
      // The RULE owns the schedule; mirroring its cursor is what moves the
      // debt's next due date (mirrorDebtSchedule below). Advancing here as well
      // would skip an instalment every time one posted.
      advanceSchedule: false,
      periodsPerYear: ppy,
      recurring: { ruleId: rule.id, dueDate },
    })
    if (!result.ok) return { ok: false, error: result.error }

    // Somebody else is mid-batch on this occurrence. Stop where we are and keep
    // the cursor: the amount for the NEXT instalment is capped against a
    // balance that is about to change, so carrying on is how two concurrent
    // materializers pay 1,000 against a 600 debt and push it into credit.
    if (result.skipped === "inflight") return { ok: true, created, fullyRepaid: false, hold: true }
    if (!result.skipped) created++

    const refreshed = await loadDebt(orgId, rule.debtAccountId)
    if (!refreshed) return { ok: false, error: "The debt this repays no longer exists" }
    row = refreshed
  }

  const outstandingAfter = toDebtLike(row).owed
  return { ok: true, created, fullyRepaid: outstandingAfter <= 0 }
}

/**
 * Copy a rule's schedule onto the debt it repays, so the planner, the payoff
 * estimate and the month's obligations describe the schedule that is actually
 * taking the money. Called after anything moves the rule — materialization,
 * create, edit, pause.
 */
export async function mirrorDebtSchedule(debtAccountId: string, rule: Pick<RuleRow, "amount" | "frequencyUnit" | "frequencyInterval" | "nextDueAt" | "active">): Promise<void> {
  await db.update(debtDetails).set(debtScheduleMirror(rule)).where(eq(debtDetails.wealthAccountId, debtAccountId))
}

/** Read one rule back after its cursor moved (the mirror needs the new next_due_at). */
export async function reloadRule(ruleId: string): Promise<RuleRow | null> {
  const [row] = await db.select().from(recurringRules).where(eq(recurringRules.id, ruleId))
  return row ?? null
}

export const greatestDate = (column: typeof recurringRules.nextDueAt, date: string) => sql`GREATEST(${column}, ${date})`

// ── Linking an existing rule to a debt, and unlinking it again ───────────────

const REFUSAL_MESSAGES: Record<LinkRefusal, string> = {
  rule_is_autosave: "A Space auto-save is managed on the Space, not here",
  rule_pays_with_card: "A repayment can't be paid with a card — a card would move the debt, not clear it",
  rule_has_no_account: "Give this rule the account it is paid from first",
  account_archived: "That account is archived — point the rule at an active one first",
  account_not_cash: "A recurring repayment must come from a bank or cash account",
  direction_mismatch: "This rule moves money the wrong way for that debt",
  debt_closed: "That debt is closed — reopen it first",
  repayment_exists: "That debt already has a recurring repayment. Stop the current one first.",
  rule_linked_elsewhere: "That payment is already repaying another debt. Unlink it there first.",
  rule_ended: "That payment has already ended — it would never pay anything.",
  rule_has_pending: "That payment still has instalments waiting to post. Open it and clear those first.",
}

export type LinkResult =
  | { ok: true; rule: RuleRow }
  | { ok: false; status: number; error: string; code: LinkRefusal | "not_found" }

/**
 * Make an existing recurring rule this debt's repayment, or (debtAccountId
 * null) hand it back as an ordinary rule.
 *
 * FORWARD ONLY, and that is the whole design. The occurrences this rule has
 * already posted were plain expenses; they stay plain expenses. Rebuilding them
 * as repayments would move balances, rewrite budget periods that have already
 * been reported on, and invent an interest split nobody recorded at the time. A
 * debt whose balance does not reflect them is reconciled instead — which is an
 * existing, visible, single-row operation.
 *
 * The cursor re-anchors to today the same way resuming does: everything before
 * the link was, by definition, not a repayment. GREATEST() so it can only ever
 * move forward, never back onto an occurrence that already posted.
 */
export async function linkRuleToDebt(
  orgId: string,
  userId: string,
  ruleId: string,
  debtAccountId: string | null,
  today: string,
): Promise<LinkResult> {
  const [rule] = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, ruleId), eq(recurringRules.organizationId, orgId)))
  if (!rule) return { ok: false, status: 404, error: "Not found", code: "not_found" }

  // ── Unlink ───────────────────────────────────────────────────────────────
  if (!debtAccountId) {
    if (!rule.debtAccountId) return { ok: true, rule }
    const [updated] = await db
      .update(recurringRules)
      .set({
        kind: "standard",
        debtAccountId: null,
        // "Transfer" is the debt engine's category and means nothing on an
        // ordinary expense. Cleared rather than guessed at, so the rule shows
        // up as uncategorised and asks to be told what it is.
        category: "",
        // Forward only, here too. The resume re-anchor only fires for a debt
        // repayment, so a PAUSED rule handed back with a cursor frozen six
        // months ago would fire the whole holiday the moment it was resumed —
        // as plain expenses, which is worse again.
        nextDueAt: sql`GREATEST(${recurringRules.nextDueAt}, ${today})`,
        lastError: "",
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(recurringRules.id, rule.id))
      .returning()
    // The debt keeps the schedule it was given: without a rule those fields are
    // its own intent again, exactly as they are for a hand-tracked debt.
    return { ok: true, rule: updated ?? rule }
  }

  // ── Link ─────────────────────────────────────────────────────────────────
  const row = await loadDebt(orgId, debtAccountId)
  if (!row) return { ok: false, status: 404, error: "Not found", code: "not_found" }

  const [account] = rule.wealthAccountId
    ? await db
        .select({ type: wealthAccounts.type, archivedAt: wealthAccounts.archivedAt })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, rule.wealthAccountId), eq(wealthAccounts.organizationId, orgId)))
    : [undefined]

  // EVERY rule linked to this debt, active or not. Counting only the active ones
  // let a debt quietly take a second rule while the first was paused, and
  // resuming then paid it twice a month.
  const siblings = await db
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(and(eq(recurringRules.organizationId, orgId), eq(recurringRules.debtAccountId, debtAccountId)))

  const refusal = linkRefusal(
    {
      id: rule.id,
      kind: rule.kind === "transfer" ? "transfer" : rule.kind === "debt" ? "debt" : "standard",
      type: rule.type === "incoming" ? "incoming" : "outgoing",
      cardId: rule.cardId,
      accountId: rule.wealthAccountId,
      accountType: account?.type ?? null,
      accountArchived: !!account?.archivedAt,
      debtAccountId: rule.debtAccountId,
      ended: !!rule.endDate && String(rule.endDate).slice(0, 10) < today,
      // The caller runs the catch-up first, so an ACTIVE rule still sitting on
      // or behind today is one the materializer refused (a plan limit, an
      // archived account). Its instalments have to land in their old shape
      // before the link moves the cursor past them.
      hasPending: rule.active && String(rule.nextDueAt).slice(0, 10) <= today,
    },
    {
      id: row.account.id,
      direction: directionOf(row.account.type),
      archived: !!row.account.archivedAt,
      linkedRuleIds: siblings.map((s) => s.id),
    },
  )
  if (refusal) return { ok: false, status: refusal === "repayment_exists" || refusal === "rule_linked_elsewhere" ? 409 : 400, error: REFUSAL_MESSAGES[refusal], code: refusal }

  const [updated] = await db
    .update(recurringRules)
    .set({
      kind: "debt",
      debtAccountId,
      // Debt repayments anchor to the org's own client at materialize time, so
      // a client this rule used to belong to is no longer true of it.
      clientId: null,
      toAccountId: null,
      category: "Transfer",
      // Never backwards: an active rule whose next occurrence is already in the
      // future must keep that date, or linking would re-post it.
      nextDueAt: sql`GREATEST(${recurringRules.nextDueAt}, ${today})`,
      // A debt that is paused, written off or settled does not take money; the
      // rule follows it, exactly as the lifecycle path does.
      ...(row.details.lifecycle === "active" ? {} : { active: false }),
      lastError: "",
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(recurringRules.id, rule.id))
    .returning()

  const fresh = updated ?? rule
  // The rule is now the schedule; the debt's own fields mirror it.
  await mirrorDebtSchedule(debtAccountId, fresh)
  return { ok: true, rule: fresh }
}
