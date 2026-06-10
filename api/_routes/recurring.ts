import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, recurringRules, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"
import { validateRuleInput, type RecurringRuleInput } from "../_lib/recurring-validate.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"

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
      .select({
        id: recurringRules.id,
        organizationId: recurringRules.organizationId,
        clientId: recurringRules.clientId,
        clientName: clients.name,
        clientIsOwn: clients.isOwn,
        wealthAccountId: recurringRules.wealthAccountId,
        accountName: sql<string | null>`coalesce(nullif(${wealthAccounts.nickname}, ''), ${wealthAccounts.bankName})`,
        name: recurringRules.name,
        type: recurringRules.type,
        amount: recurringRules.amount,
        category: recurringRules.category,
        frequencyUnit: recurringRules.frequencyUnit,
        frequencyInterval: recurringRules.frequencyInterval,
        startDate: recurringRules.startDate,
        endDate: recurringRules.endDate,
        nextDueAt: recurringRules.nextDueAt,
        active: recurringRules.active,
        lastError: recurringRules.lastError,
        createdAt: recurringRules.createdAt,
        generatedCount: sql<number>`(select count(*)::int from transactions t where t.recurring_rule_id = ${recurringRules.id} and t.deleted_at is null)`,
      })
      .from(recurringRules)
      .leftJoin(clients, eq(clients.id, recurringRules.clientId))
      .leftJoin(wealthAccounts, eq(wealthAccounts.id, recurringRules.wealthAccountId))
      .where(eq(recurringRules.organizationId, orgId))
      .orderBy(desc(recurringRules.active), asc(recurringRules.nextDueAt), asc(recurringRules.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const parsed = validateRuleInput(req.body as RecurringRuleInput)
    if ("error" in parsed) return res.status(400).json({ error: parsed.error })
    const refError = await assertRefsBelongToOrg(orgId, parsed.value.clientId, parsed.value.wealthAccountId)
    if (refError) return res.status(400).json({ error: refError })

    const [row] = await db
      .insert(recurringRules)
      .values({
        organizationId: orgId,
        clientId: parsed.value.clientId,
        wealthAccountId: parsed.value.wealthAccountId,
        name: parsed.value.name,
        type: parsed.value.type,
        amount: parsed.value.amount,
        category: parsed.value.category,
        frequencyUnit: parsed.value.frequencyUnit,
        frequencyInterval: parsed.value.frequencyInterval,
        startDate: parsed.value.startDate,
        endDate: parsed.value.endDate,
        // The cursor starts at the anchor: a backdated start_date intentionally
        // catches up (creates the missed occurrences) on the next materialize.
        nextDueAt: parsed.value.startDate,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    // Materialize immediately so a backdated rule shows its transactions right
    // away (and today's occurrence fires on a rule starting today).
    const { created } = await materializeDueRecurring(orgId)
    const [fresh] = await db.select().from(recurringRules).where(eq(recurringRules.id, row.id))
    return res.status(201).json({ ...serialize(fresh ?? row), created_now: created })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
