import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, recurringRules, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { todayIso } from "../../../src/lib/recurring.js"
import { materializeDueRecurring } from "../../_lib/recurring-materialize.js"
import { validateRuleInput, type RecurringRuleInput } from "../../_lib/recurring-validate.js"
import { ruleFields, ruleStatsFields } from "../../_lib/recurring-query.js"
import { attributeCard } from "../../_lib/cards.js"
import { directionOf, loadDebt } from "../../_lib/debts.js"
import { greatestDate, linkRuleToDebt, mirrorDebtSchedule, reloadRule } from "../../_lib/recurring-debt.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One rule in the shape every read returns it: the list's joined fields plus
 * what it has posted. PATCH answers with this too, so the page that saved a
 * rule can paint the result without a follow-up GET.
 */
async function readRule(orgId: string, id: string) {
  const [row] = await db
    .select({ ...ruleFields, ...ruleStatsFields })
    .from(recurringRules)
    .leftJoin(clients, eq(clients.id, recurringRules.clientId))
    .leftJoin(wealthAccounts, eq(wealthAccounts.id, recurringRules.wealthAccountId))
    .where(and(eq(recurringRules.id, id), eq(recurringRules.organizationId, orgId)))
  return row ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }
  // A malformed id would otherwise reach Postgres as an invalid uuid literal and
  // come back a 500 — a deep link to a deleted/mistyped rule must read as "gone".
  if (!id || !UUID_RE.test(id)) return res.status(404).json({ error: "Not found" })

  // One rule, with everything its page shows: the same joined fields the list
  // returns, plus what it has posted so far.
  if (req.method === "GET") {
    // Catch up first, exactly like the list, so next-due and the counts below
    // include anything that became due since the last read.
    await materializeDueRecurring(orgId)
    const row = await readRule(orgId, id)
    if (!row) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(row))
  }

  const [rule] = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, id), eq(recurringRules.organizationId, orgId)))
  if (!rule) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as RecurringRuleInput & { active?: boolean; debt_account_id?: string | null }

    // Link this rule to a debt (or hand it back). BOTH screens come through
    // here — the debt adopting a rule and the rule being pointed at a debt are
    // the same operation, so there is one implementation and one set of rules
    // (api/_lib/recurring-debt.ts linkRuleToDebt). It is FORWARD ONLY:
    // occurrences already posted stay exactly as they were posted.
    if (body.debt_account_id !== undefined) {
      // Linking is its OWN request. Combined with other edits it could not be
      // atomic — the link commits first and a later validation error would
      // return 400 on a rule that had already been linked and re-anchored.
      if (Object.keys(body).filter((k) => k !== "debt_account_id").length > 0) {
        return res.status(400).json({ error: "Link this payment to a debt on its own, then edit it", code: "link_alone" })
      }
      // Post anything ALREADY due before the change takes effect — in BOTH
      // directions. Linking and unlinking each move the cursor forward, so an
      // occurrence due last week but not yet materialised would otherwise be
      // stepped over entirely, or post in the wrong shape. This way the past
      // lands as what it was and the change starts from the next one, which is
      // what "forward only" has to mean.
      await materializeDueRecurring(orgId)
      const linked = await linkRuleToDebt(orgId, userId, id, body.debt_account_id || null, todayIso())
      if (!linked.ok) return res.status(linked.status).json({ error: linked.error, code: linked.code })
      // Post anything that became due the moment it changed hands.
      if (linked.rule.active) await materializeDueRecurring(orgId)
      const fresh = await readRule(orgId, id)
      return res.json(serialize(fresh ?? linked.rule))
    }

    // Pause / resume is a lightweight toggle that skips full validation.
    const onlyActive = typeof body.active === "boolean" && Object.keys(body).filter((k) => k !== "active").length === 0
    if (onlyActive) {
      const [updated] = await db
        .update(recurringRules)
        .set({
          active: body.active,
          // Resuming a DEBT repayment re-anchors to today. An inactive rule's
          // cursor is frozen, so a six-month payment holiday resumed from this
          // screen would otherwise post six back-dated instalments and take
          // thousands out of the bank in one tap — see the same rule on the
          // debt's own screen (src/lib/debt-recurring.ts repaymentCursor) and
          // docs/debts/DEBTS.md. Other rule kinds keep the documented catch-up.
          ...(body.active && rule.kind === "debt" ? { nextDueAt: greatestDate(recurringRules.nextDueAt, todayIso()) } : {}),
          lastError: "",
          updatedBy: userId,
          updatedAt: new Date(),
        })
        // Defense-in-depth: re-scope by org even though the load above 404s
        // cross-org ids (matches every other [id] route's mutation pattern).
        .where(and(eq(recurringRules.id, id), eq(recurringRules.organizationId, orgId)))
        .returning()
      if (body.active) await materializeDueRecurring(orgId)
      await syncDebt(rule.kind, rule.debtAccountId, id)
      const fresh = await readRule(orgId, id)
      return res.json(serialize(fresh ?? updated))
    }

    const parsed = validateRuleInput({
      name: body.name ?? rule.name,
      type: body.type ?? rule.type,
      amount: body.amount ?? rule.amount,
      category: body.category ?? rule.category,
      client_id: body.client_id !== undefined ? body.client_id : rule.clientId,
      wealth_account_id: body.wealth_account_id !== undefined ? body.wealth_account_id : rule.wealthAccountId,
      // The (card, account) pair moves together: a new card → its account; a
      // new account without a card → that account's credit card, if any.
      card_id: body.card_id !== undefined ? body.card_id : body.wealth_account_id !== undefined ? null : rule.cardId,
      frequency_unit: body.frequency_unit ?? rule.frequencyUnit,
      frequency_interval: body.frequency_interval ?? rule.frequencyInterval,
      start_date: body.start_date ?? rule.startDate,
      end_date: body.end_date !== undefined ? body.end_date : rule.endDate,
    })
    if ("error" in parsed) return res.status(400).json({ error: parsed.error })
    const attributed = await attributeCard(orgId, {
      cardId: parsed.value.cardId,
      wealthAccountId: body.card_id && body.wealth_account_id === undefined ? undefined : parsed.value.wealthAccountId,
    })
    if (!attributed.ok) return res.status(400).json({ error: attributed.error })

    // On a debt repayment, `wealth_account_id` names the account the money is
    // PAID FROM — the debt itself is in `debt_account_id`. Pointing the payer at
    // a debt account would make the rule pay a loan out of a loan, which the
    // engine has no meaning for.
    if (rule.kind === "debt") {
      // The eligibility rules are enforced at LINK time; an edit must not be a
      // way around them. A card would move the debt rather than clear it, and a
      // direction flip would turn a repayment into money arriving from nowhere.
      if (attributed.cardId) return res.status(400).json({ error: "A repayment can't be paid with a card — a card would move the debt, not clear it", code: "rule_pays_with_card" })
      if (rule.debtAccountId) {
        const target = await loadDebt(orgId, rule.debtAccountId)
        const wanted = target && directionOf(target.account.type) === "receivable" ? "incoming" : "outgoing"
        if (parsed.value.type !== wanted) return res.status(400).json({ error: "This rule moves money the wrong way for that debt", code: "direction_mismatch" })
      }
      if (!attributed.accountId) return res.status(400).json({ error: "Choose the account this repayment is paid from" })
      const [payer] = await db
        .select({ type: wealthAccounts.type, archivedAt: wealthAccounts.archivedAt })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, attributed.accountId), eq(wealthAccounts.organizationId, orgId)))
      if (!payer || payer.archivedAt || (payer.type !== "bank" && payer.type !== "cash")) {
        return res.status(400).json({ error: "A recurring repayment must come from a bank or cash account" })
      }
    }

    // Editing the schedule re-anchors FORWARD-ONLY: already-created transactions
    // stay, and the cursor never goes back in time (no retroactive catch-up on
    // edit — that's a create-time behavior).
    const scheduleChanged =
      parsed.value.startDate !== rule.startDate ||
      parsed.value.frequencyUnit !== rule.frequencyUnit ||
      parsed.value.frequencyInterval !== rule.frequencyInterval
    const today = todayIso()
    // A debt repayment coming back to life re-anchors too, whether it is being
    // resumed on its own or alongside other edits.
    const resumingDebt = rule.kind === "debt" && !rule.active && body.active === true
    const nextDueAt = scheduleChanged || resumingDebt
      ? (parsed.value.startDate > today ? parsed.value.startDate : today)
      : rule.nextDueAt

    const [updated] = await db
      .update(recurringRules)
      .set({
        name: parsed.value.name,
        type: parsed.value.type,
        amount: parsed.value.amount,
        category: parsed.value.category,
        clientId: parsed.value.clientId,
        wealthAccountId: attributed.accountId,
        cardId: attributed.cardId,
        frequencyUnit: parsed.value.frequencyUnit,
        frequencyInterval: parsed.value.frequencyInterval,
        startDate: parsed.value.startDate,
        endDate: parsed.value.endDate,
        nextDueAt,
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
        lastError: "",
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(recurringRules.id, id), eq(recurringRules.organizationId, orgId)))
      .returning()

    await materializeDueRecurring(orgId)
    await syncDebt(rule.kind, rule.debtAccountId, id)
    const fresh = await readRule(orgId, id)
    return res.json(serialize(fresh ?? updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Already-created transactions are kept (their recurring_rule_id keeps the
    // history; the FK is plain uuid, not enforced, so rows simply stop matching
    // a live rule and the icon falls back gracefully).
    await db.delete(recurringRules).where(and(eq(recurringRules.id, id), eq(recurringRules.organizationId, orgId)))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}

/**
 * Copy a debt repayment's schedule back onto the debt it services. The rule is
 * the single source of truth for what is paid and when; the debt's own
 * payment_amount / payment_frequency / next_due_date are a mirror, and the
 * planner, the payoff estimate and the month's obligations all read the mirror.
 * Skipping this is how the plan comes to describe a schedule nobody is paying.
 */
async function syncDebt(kind: string, debtAccountId: string | null, ruleId: string): Promise<void> {
  if (kind !== "debt" || !debtAccountId) return
  const fresh = await reloadRule(ruleId)
  if (fresh) await mirrorDebtSchedule(debtAccountId, fresh)
}
