import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { recurringRules, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { canWrite, isPersonalAccount, requireAuth } from "../../../_lib/auth.js"
import { validateRuleInput, type RecurringRuleInput } from "../../../_lib/recurring-validate.js"
import { materializeDueRecurring } from "../../../_lib/recurring-materialize.js"
import { monthlyEquivalent, type SpaceFrequencyUnit } from "../../../../src/lib/spaces.js"

// /api/spaces/:id/auto-save — the ONE recurring auto-save (a kind='transfer'
// recurring rule) that funds this Space from a chosen bank/cash account on a
// schedule. GET the current rule (or null), PUT to upsert it, DELETE to stop.

const ruleFields = {
  id: recurringRules.id,
  organizationId: recurringRules.organizationId,
  kind: recurringRules.kind,
  wealthAccountId: recurringRules.wealthAccountId,
  toAccountId: recurringRules.toAccountId,
  name: recurringRules.name,
  amount: recurringRules.amount,
  frequencyUnit: recurringRules.frequencyUnit,
  frequencyInterval: recurringRules.frequencyInterval,
  startDate: recurringRules.startDate,
  endDate: recurringRules.endDate,
  nextDueAt: recurringRules.nextDueAt,
  active: recurringRules.active,
  lastError: recurringRules.lastError,
  createdAt: recurringRules.createdAt,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  if (!isPersonalAccount(ctx)) return res.status(403).json({ error: "Spaces are available on personal accounts only" })

  const [space] = await db
    .select({ id: wealthAccounts.id, nickname: wealthAccounts.nickname, bankName: wealthAccounts.bankName })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "space")))
  if (!space) return res.status(404).json({ error: "Space not found" })

  const findRule = async () => {
    const [rule] = await db
      .select(ruleFields)
      .from(recurringRules)
      .where(and(eq(recurringRules.organizationId, orgId), eq(recurringRules.kind, "transfer"), eq(recurringRules.toAccountId, id)))
    return rule ?? null
  }

  const withDerived = (rule: Awaited<ReturnType<typeof findRule>>) =>
    rule
      ? { ...serialize(rule), monthly_equivalent: monthlyEquivalent(Number(rule.amount), rule.frequencyUnit as SpaceFrequencyUnit, rule.frequencyInterval) }
      : null

  if (req.method === "GET") {
    return res.json(withDerived(await findRule()))
  }

  if (req.method === "PUT") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      source_account_id?: string
      amount?: number | string
      frequency_unit?: string
      frequency_interval?: number
      start_date?: string
      end_date?: string | null
    }
    if (!body.source_account_id) return res.status(400).json({ error: "source_account_id is required" })

    // The source must be one of the org's active bank/cash accounts — never a
    // Space (you can't auto-save from a Space into a Space).
    const [source] = await db
      .select({ id: wealthAccounts.id, type: wealthAccounts.type, archivedAt: wealthAccounts.archivedAt })
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.id, body.source_account_id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
    if (!source || source.type === "space") return res.status(400).json({ error: "Choose an active bank or cash account to save from" })
    if (source.id === id) return res.status(400).json({ error: "Source and destination must differ" })

    const spaceName = space.nickname.trim() || space.bankName || "Space"
    // Reuse the recurring validator for the shared fields (amount / frequency /
    // dates); a transfer rule's `type` is always 'outgoing' (the source leg).
    const parsed = validateRuleInput({
      name: `Auto-save to ${spaceName}`,
      type: "outgoing",
      amount: body.amount,
      category: "Transfer",
      wealth_account_id: body.source_account_id,
      frequency_unit: body.frequency_unit,
      frequency_interval: body.frequency_interval,
      start_date: body.start_date,
      end_date: body.end_date ?? null,
    } as RecurringRuleInput)
    if ("error" in parsed) return res.status(400).json({ error: parsed.error })
    const v = parsed.value

    const existing = await findRule()
    if (existing) {
      await db
        .update(recurringRules)
        .set({
          wealthAccountId: v.wealthAccountId,
          name: v.name,
          amount: v.amount,
          frequencyUnit: v.frequencyUnit,
          frequencyInterval: v.frequencyInterval,
          startDate: v.startDate,
          endDate: v.endDate,
          active: true,
          // Don't rewind the cursor below the new start; never move it backwards.
          nextDueAt: v.startDate > existing.nextDueAt ? v.startDate : existing.nextDueAt,
          lastError: "",
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(recurringRules.id, existing.id))
    } else {
      await db.insert(recurringRules).values({
        organizationId: orgId,
        clientId: null, // transfers anchor to the org's default client at materialize time
        kind: "transfer",
        wealthAccountId: v.wealthAccountId,
        toAccountId: id,
        name: v.name,
        type: "outgoing",
        amount: v.amount,
        category: "Transfer",
        frequencyUnit: v.frequencyUnit,
        frequencyInterval: v.frequencyInterval,
        startDate: v.startDate,
        endDate: v.endDate,
        nextDueAt: v.startDate,
        createdBy: userId,
        updatedBy: userId,
      })
    }

    // Fire any due occurrence right away (e.g. a backdated start).
    const { created } = await materializeDueRecurring(orgId)
    return res.status(existing ? 200 : 201).json({ ...withDerived(await findRule()), created_now: created })
  }

  if (req.method === "DELETE") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const existing = await findRule()
    if (existing) await db.delete(recurringRules).where(eq(recurringRules.id, existing.id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
