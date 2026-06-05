import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth } from "../../../_lib/auth.js"
import { diffFields, logAudit } from "../../../_lib/audit.js"

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  const [account] = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
  if (!account) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") return res.json(serialize(account))

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      bank_name?: string
      bankName?: string
      nickname?: string
      icon?: string
      current_balance?: number
      currentBalance?: number
      archive?: boolean
      restore?: boolean
    }
    const { nickname, icon, archive, restore } = body
    const bankName = body.bankName ?? body.bank_name
    const currentBalance = body.currentBalance ?? body.current_balance

    // Cash in Hand is the default account and must always exist — it can be
    // renamed/re-iconed and have its balance adjusted, but never archived.
    if (archive && account.type === "cash") {
      return res.status(400).json({ error: "Cash in Hand can't be archived" })
    }

    if (account.type === "bank" && bankName !== undefined && !bankName.trim()) {
      return res.status(400).json({ error: "bankName is required" })
    }
    if (icon !== undefined && !icon.trim()) {
      return res.status(400).json({ error: "icon is required" })
    }

    if (restore && account.archivedAt) {
      if (account.type === "cash") {
        const [{ total }] = await db
          .select({ total: count() })
          .from(wealthAccounts)
          .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "cash"), isNull(wealthAccounts.archivedAt)))
        if (total >= 1) return res.status(400).json({ error: "Cash in Hand already exists" })
      }
      if (account.type === "bank") {
        const [{ total }] = await db
          .select({ total: count() })
          .from(wealthAccounts)
          .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "bank"), isNull(wealthAccounts.archivedAt)))
        if (total >= 5) return res.status(400).json({ error: "Maximum 5 bank accounts allowed" })
      }
    }

    const [before] = await db.select().from(wealthAccounts).where(eq(wealthAccounts.id, id))
    const oldBalance = money(before.currentBalance)
    const newBalance = currentBalance !== undefined ? money(currentBalance) : oldBalance
    const delta = newBalance - oldBalance

    if (delta !== 0) {
      const clientId = await ensureDefaultClient(orgId, userId)
      const txType = delta > 0 ? "incoming" : "outgoing"
      const [tx] = await db
        .insert(transactions)
        .values({
          clientId,
          wealthAccountId: id,
          type: txType,
          amount: String(Math.abs(delta)),
          description: "Balance Adjustment",
          category: "Adjustment",
          date: new Date().toISOString().split("T")[0],
          isSystem: true,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning()
      await logAudit({ orgId, entityType: "transaction", entityId: tx.id, action: "create", actorId: userId })
    }

    const [updated] = await db
      .update(wealthAccounts)
      .set({
        ...(bankName !== undefined ? { bankName: bankName.trim() || "Cash in Hand" } : {}),
        ...(nickname !== undefined ? { nickname: nickname.trim() } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(currentBalance !== undefined ? { currentBalance: String(newBalance) } : {}),
        ...(archive ? { archivedAt: new Date() } : {}),
        ...(restore ? { archivedAt: null } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(wealthAccounts.id, id))
      .returning()

    const changes = diffFields(
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["bankName", "nickname", "icon", "currentBalance", "archivedAt"],
    )
    if (Object.keys(changes).length) {
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: archive ? "close" : restore ? "reopen" : "update", actorId: userId, changes })
    }
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    // Cash in Hand is permanent — never deleted or archived.
    if (account.type === "cash") {
      return res.status(400).json({ error: "Cash in Hand can't be removed" })
    }
    const [{ total }] = await db
      .select({ total: count() })
      .from(transactions)
      .where(and(eq(transactions.wealthAccountId, id), isNull(transactions.deletedAt)))

    if (total > 0) {
      const [updated] = await db
        .update(wealthAccounts)
        .set({ archivedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, id))
        .returning()
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "close", actorId: userId })
      return res.json(serialize(updated))
    }

    await db.delete(wealthAccounts).where(eq(wealthAccounts.id, id))
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
