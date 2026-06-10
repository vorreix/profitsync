import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { recurringRules } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { todayIso } from "../../../src/lib/recurring.js"
import { materializeDueRecurring } from "../../_lib/recurring-materialize.js"
import { validateRuleInput, type RecurringRuleInput } from "../../_lib/recurring-validate.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

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
        .where(eq(recurringRules.id, id))
        .returning()
      if (body.active) await materializeDueRecurring(orgId)
      const [fresh] = await db.select().from(recurringRules).where(eq(recurringRules.id, id))
      return res.json(serialize(fresh ?? updated))
    }

    const parsed = validateRuleInput({
      name: body.name ?? rule.name,
      type: body.type ?? rule.type,
      amount: body.amount ?? rule.amount,
      category: body.category ?? rule.category,
      client_id: body.client_id !== undefined ? body.client_id : rule.clientId,
      wealth_account_id: body.wealth_account_id !== undefined ? body.wealth_account_id : rule.wealthAccountId,
      frequency_unit: body.frequency_unit ?? rule.frequencyUnit,
      frequency_interval: body.frequency_interval ?? rule.frequencyInterval,
      start_date: body.start_date ?? rule.startDate,
      end_date: body.end_date !== undefined ? body.end_date : rule.endDate,
    })
    if ("error" in parsed) return res.status(400).json({ error: parsed.error })

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
        wealthAccountId: parsed.value.wealthAccountId,
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
      .where(eq(recurringRules.id, id))
      .returning()

    await materializeDueRecurring(orgId)
    const [fresh] = await db.select().from(recurringRules).where(eq(recurringRules.id, id))
    return res.json(serialize(fresh ?? updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Already-created transactions are kept (their recurring_rule_id keeps the
    // history; the FK is plain uuid, not enforced, so rows simply stop matching
    // a live rule and the icon falls back gracefully).
    await db.delete(recurringRules).where(eq(recurringRules.id, id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
