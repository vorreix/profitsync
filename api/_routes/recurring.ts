import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, desc, eq, ne } from "drizzle-orm"
import { db, dbBatch, serialize } from "../../src/lib/db/index.js"
import { clients, debtDetails, recurringRules, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"
import { validateRuleInput, type RecurringRuleInput } from "../_lib/recurring-validate.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { ruleFields } from "../_lib/recurring-query.js"
import { attributeCard } from "../_lib/cards.js"
import { debtScheduleMirror, directionOf, loadDebt } from "../_lib/debts.js"
import { payerShape, refusalForNew, refusalMessage, refusalStatus } from "../_lib/recurring-debt.js"
import type { LinkTargetDebt } from "../../src/lib/debt-recurring.js"
import { todayIso } from "../../src/lib/recurring.js"

async function assertRefsBelongToOrg(orgId: string, clientId: string | null, accountId: string | null): Promise<string | null> {
  if (clientId) {
    const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)))
    if (!c) return "client not found"
  }
  if (accountId) {
    const [a] = await db
      .select({ id: wealthAccounts.id, archivedAt: wealthAccounts.archivedAt })
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.id, accountId), eq(wealthAccounts.organizationId, orgId)))
    if (!a) return "account not found"
    if (a.archivedAt) return "account is archived"
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    // Catch up first so "next due" + the generated count below are truthful.
    await materializeDueRecurring(orgId)
    const rows = await db
      .select(ruleFields)
      .from(recurringRules)
      .leftJoin(clients, eq(clients.id, recurringRules.clientId))
      .leftJoin(wealthAccounts, eq(wealthAccounts.id, recurringRules.wealthAccountId))
      // Exclude Space auto-saves (kind='transfer') — those are managed on /spaces,
      // not in the income/expense Recurring list.
      .where(and(eq(recurringRules.organizationId, orgId), ne(recurringRules.kind, "transfer")))
      .orderBy(desc(recurringRules.active), asc(recurringRules.nextDueAt), asc(recurringRules.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const parsed = validateRuleInput(req.body as RecurringRuleInput)
    if ("error" in parsed) return res.status(400).json({ error: parsed.error })
    // The paying card decides the account (api/_lib/cards.ts attributeCard).
    const attributed = await attributeCard(orgId, { cardId: parsed.value.cardId, wealthAccountId: parsed.value.wealthAccountId })
    if (!attributed.ok) return res.status(400).json({ error: attributed.error })
    const refError = await assertRefsBelongToOrg(orgId, parsed.value.clientId, attributed.accountId)
    if (refError) return res.status(400).json({ error: refError })

    // Born already attached to a debt. "This new standing order pays my car
    // loan" is one intention, so the rule and the debt's mirrored schedule
    // commit together — creating the rule and then linking it would leave a
    // plain expense behind if the second request never landed.
    const debtAccountId = typeof (req.body as { debt_account_id?: unknown }).debt_account_id === "string"
      ? String((req.body as { debt_account_id?: string }).debt_account_id).trim()
      : ""
    const today = todayIso()
    let debtRow = null as Awaited<ReturnType<typeof loadDebt>>
    if (debtAccountId) {
      debtRow = await loadDebt(orgId, debtAccountId)
      if (!debtRow) return res.status(404).json({ error: "Not found" })
      const payer = await payerShape(orgId, attributed.accountId)
      const siblings = await db
        .select({ id: recurringRules.id })
        .from(recurringRules)
        .where(and(eq(recurringRules.organizationId, orgId), eq(recurringRules.debtAccountId, debtAccountId)))
      const refusal = refusalForNew(
        {
          // The rule does not exist yet, so nothing is pending and nothing has ended.
          id: "new", kind: "standard", type: parsed.value.type, cardId: attributed.cardId,
          accountId: attributed.accountId, accountType: payer.type, accountArchived: payer.archived,
          debtAccountId: null, endDate: parsed.value.endDate, active: false,
        },
        {
          id: debtRow.account.id,
          direction: directionOf(debtRow.account.type),
          archived: !!debtRow.account.archivedAt,
          lifecycle: debtRow.details.lifecycle as LinkTargetDebt["lifecycle"],
          linkedRuleIds: siblings.map((x) => x.id),
        },
        today,
      )
      if (refusal) return res.status(refusalStatus(refusal)).json({ error: refusalMessage(refusal), code: refusal })
    }

    // Forward only: a debt repayment never back-posts occurrences from before it
    // was a repayment, so its cursor starts no earlier than today. An ordinary
    // rule keeps the documented catch-up from its anchor.
    const cursor = debtRow ? (parsed.value.startDate > today ? parsed.value.startDate : today) : parsed.value.startDate
    // The rule follows the debt, exactly as linkRuleToDebt does. A paused debt
    // takes no money, so its repayment is born inactive rather than born active
    // and immediately refused by the engine on every materialize — which is how
    // a rule ends up wearing a permanent last_error nobody asked for.
    const live = !debtRow || debtRow.details.lifecycle === "active"
    const ruleId = crypto.randomUUID()
    const values = {
      id: ruleId,
      organizationId: orgId,
      // A debt repayment anchors to the org's own client, never a real one.
      clientId: debtRow ? null : parsed.value.clientId,
      wealthAccountId: attributed.accountId,
      cardId: attributed.cardId,
      ...(debtRow ? { kind: "debt" as const, debtAccountId: debtRow.account.id } : {}),
      name: parsed.value.name,
      type: parsed.value.type,
      amount: parsed.value.amount,
      category: debtRow ? "Transfer" : parsed.value.category,
      frequencyUnit: parsed.value.frequencyUnit,
      frequencyInterval: parsed.value.frequencyInterval,
      startDate: parsed.value.startDate,
      endDate: parsed.value.endDate,
      nextDueAt: cursor,
      ...(live ? {} : { active: false }),
      createdBy: userId,
      updatedBy: userId,
    }

    if (debtRow) {
      // One batch: the rule and the schedule it now owns on the debt.
      await dbBatch([
        db.insert(recurringRules).values(values),
        db.update(debtDetails)
          // active: live — a paused debt mirrors no next date, or derivedStatus
          // reads a date nothing will honour and calls the debt overdue.
          .set(debtScheduleMirror({ amount: values.amount, frequencyUnit: values.frequencyUnit, frequencyInterval: values.frequencyInterval, nextDueAt: cursor, active: live }))
          .where(eq(debtDetails.wealthAccountId, debtRow.account.id)),
      ] as unknown as Parameters<typeof dbBatch>[0])
    } else {
      await db.insert(recurringRules).values(values)
    }
    const [row] = await db.select().from(recurringRules).where(eq(recurringRules.id, ruleId))

    // Materialize immediately so a backdated rule shows its transactions right
    // away (and today's occurrence fires on a rule starting today).
    const { created } = await materializeDueRecurring(orgId)
    const [fresh] = await db.select().from(recurringRules).where(eq(recurringRules.id, ruleId))
    return res.status(201).json({ ...serialize(fresh ?? row), created_now: created })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
