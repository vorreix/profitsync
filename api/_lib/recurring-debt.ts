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

import { eq, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { debtDetails, recurringRules } from "../../src/lib/db/schema.js"
import { fromCents, toCents } from "../../src/lib/debt-math.js"
import { payoffCappedAmount, periodsPerYearForRule } from "../../src/lib/debt-recurring.js"
import { debtScheduleMirror, loadDebt, recordDebtPayment, toDebtLike } from "./debts.js"
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
