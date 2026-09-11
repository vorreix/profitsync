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
    const body = req.body as RecurringRuleInput & { active?: boolean }

    // Pause / resume is a lightweight toggle that skips full validation.
    const onlyActive = typeof body.active === "boolean" && Object.keys(body).filter((k) => k !== "active").length === 0
    if (onlyActive) {
      const [updated] = await db
        .update(recurringRules)
        .set({ active: body.active, lastError: "", updatedBy: userId, updatedAt: new Date() })
        // Defense-in-depth: re-scope by org even though the load above 404s
        // cross-org ids (matches every other [id] route's mutation pattern).
        .where(and(eq(recurringRules.id, id), eq(recurringRules.organizationId, orgId)))
        .returning()
      if (body.active) await materializeDueRecurring(orgId)
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

    // Editing the schedule re-anchors FORWARD-ONLY: already-created transactions
    // stay, and the cursor never goes back in time (no retroactive catch-up on
    // edit — that's a create-time behavior).
    const scheduleChanged =
      parsed.value.startDate !== rule.startDate ||
      parsed.value.frequencyUnit !== rule.frequencyUnit ||
      parsed.value.frequencyInterval !== rule.frequencyInterval
    const today = todayIso()
    const nextDueAt = scheduleChanged
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
