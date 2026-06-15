import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, eq, isNull, max, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, canUseSpaces, requireAuth } from "../_lib/auth.js"
import { logAudit } from "../_lib/audit.js"
import { checkSpaceQuota } from "../_lib/quota.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { parseGoal, parseTargetDate, spaceFields } from "../_lib/spaces.js"

// Spaces = personal savings buckets (wealth_accounts rows with type='space').
// Money only ever TRANSFERS in/out (kind='transfer'); you can never spend FROM a
// Space. A Space carries an optional goal_amount + target_date; the monthly
// suggestion + progress are derived client-side (src/lib/spaces.ts), so the API
// just returns the raw fields. Personal accounts only.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  // Spaces are a savings feature for personal accounts and families (shared
  // family spaces). Business workspaces never have them.
  if (!canUseSpaces(ctx)) return res.status(403).json({ error: "Spaces aren't available on this account type" })

  if (req.method === "GET") {
    // Materialize any due auto-save (recurring transfer) occurrences first, so a
    // Space's balance is current before its card renders.
    await materializeDueRecurring(orgId)
    const rows = await db
      .select({
        ...spaceFields,
        transactionCount: count(transactions.id),
        attachmentCount: sql<number>`(select count(*)::int from wealth_account_attachments where wealth_account_id = ${wealthAccounts.id})`,
      })
      .from(wealthAccounts)
      .leftJoin(transactions, and(eq(transactions.wealthAccountId, wealthAccounts.id), isNull(transactions.deletedAt)))
      .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "space")))
      .groupBy(wealthAccounts.id)
      .orderBy(sql`${wealthAccounts.archivedAt} is not null`, asc(wealthAccounts.position), asc(wealthAccounts.createdAt))
    return res.json(rows.map((r) => serialize(r)))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      name?: string
      goal_amount?: number | string | null
      target_date?: string | null
      icon?: string
    }
    const name = (body.name ?? "").trim()
    if (!name) return res.status(400).json({ error: "name is required" })

    const goalAmount = parseGoal(body.goal_amount)
    if (goalAmount === "invalid") return res.status(400).json({ error: "goal_amount is invalid" })
    const targetDate = parseTargetDate(body.target_date)
    if (targetDate === "invalid") return res.status(400).json({ error: "target_date must be YYYY-MM-DD" })

    // Plan gate: free personal = 1 Space, paid personal = 7.
    const quota = await checkSpaceQuota(orgId)
    if (!quota.allowed) return res.status(402).json(quota)

    // Append after the user's existing Space order.
    const [{ maxPos }] = await db
      .select({ maxPos: max(wealthAccounts.position) })
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "space")))

    const [row] = await db
      .insert(wealthAccounts)
      .values({
        organizationId: orgId,
        type: "space",
        bankName: "",
        nickname: name,
        openingBalance: "0", // a Space starts empty; you fund it via transfer
        currentBalance: "0",
        icon: body.icon || "piggy",
        goalAmount,
        targetDate,
        position: (maxPos ?? -1) + 1,
        // A Space is never the org's default account.
        createdBy: userId,
        updatedBy: userId,
      })
      .returning(spaceFields)

    await logAudit({ orgId, entityType: "wealth_account", entityId: row.id, action: "create", actorId: userId })
    return res.status(201).json(serialize({ ...row, transactionCount: 0, attachmentCount: 0 }))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
