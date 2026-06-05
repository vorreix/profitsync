import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"

const MAX_BANK_ACCOUNTS = 5

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function createSystemTransaction({
  orgId,
  userId,
  accountId,
  amount,
  type,
  description,
  category,
}: {
  orgId: string
  userId: string
  accountId: string
  amount: number
  type: "incoming" | "outgoing"
  description: string
  category: string
}) {
  if (amount <= 0) return
  const clientId = await ensureDefaultClient(orgId, userId)
  const today = new Date().toISOString().split("T")[0]
  const [row] = await db
    .insert(transactions)
    .values({
      clientId,
      wealthAccountId: accountId,
      type,
      amount: String(amount),
      description,
      category,
      date: today,
      isSystem: true,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const rows = await db
      .select({
        id: wealthAccounts.id,
        organizationId: wealthAccounts.organizationId,
        type: wealthAccounts.type,
        bankName: wealthAccounts.bankName,
        nickname: wealthAccounts.nickname,
        openingBalance: wealthAccounts.openingBalance,
        currentBalance: wealthAccounts.currentBalance,
        icon: wealthAccounts.icon,
        archivedAt: wealthAccounts.archivedAt,
        createdAt: wealthAccounts.createdAt,
        updatedAt: wealthAccounts.updatedAt,
        transactionCount: count(transactions.id),
      })
      .from(wealthAccounts)
      .leftJoin(transactions, and(eq(transactions.wealthAccountId, wealthAccounts.id), isNull(transactions.deletedAt)))
      .where(eq(wealthAccounts.organizationId, orgId))
      .groupBy(wealthAccounts.id)
      .orderBy(sql`${wealthAccounts.archivedAt} is not null`, desc(wealthAccounts.createdAt))

    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      type?: string
      bank_name?: string
      bankName?: string
      nickname?: string
      opening_balance?: number
      openingBalance?: number
      icon?: string
    }
    const { type, nickname, icon } = body
    const bankName = body.bankName ?? body.bank_name ?? ""
    const openingBalance = body.openingBalance ?? body.opening_balance ?? 0
    if (type !== "bank" && type !== "cash") return res.status(400).json({ error: "type must be bank or cash" })

    if (type === "bank") {
      const name = bankName.trim()
      if (!name) return res.status(400).json({ error: "bank_name is required" })
      const [{ total }] = await db
        .select({ total: count() })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "bank"), isNull(wealthAccounts.archivedAt)))
      if (total >= MAX_BANK_ACCOUNTS) return res.status(400).json({ error: "Maximum 5 bank accounts allowed" })
    }

    if (type === "cash") {
      const [{ total }] = await db
        .select({ total: count() })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "cash"), isNull(wealthAccounts.archivedAt)))
      if (total >= 1) return res.status(400).json({ error: "Only one Cash in Hand account allowed" })
    }

    const opening = money(openingBalance)
    const [row] = await db
      .insert(wealthAccounts)
      .values({
        organizationId: orgId,
        type,
        bankName: type === "cash" ? "Cash in Hand" : bankName.trim(),
        nickname: (nickname ?? "").trim(),
        openingBalance: String(opening),
        currentBalance: String(opening),
        icon: icon || (type === "cash" ? "wallet" : "bank"),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    if (opening > 0) {
      await createSystemTransaction({
        orgId,
        userId,
        accountId: row.id,
        amount: opening,
        type: "incoming",
        description: "Opening Balance",
        category: "Opening Balance",
      })
    }

    await logAudit({ orgId, entityType: "wealth_account", entityId: row.id, action: "create", actorId: userId })
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
