import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { checkNoteLength } from "../../_lib/quota.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

const VALID_STATUSES = ["active", "inactive", "archived"]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const [row] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    if (!row) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(row))
  }

  if (req.method === "PATCH") {
    if (!requireBusinessFeature(res, ctx, "clients")) return
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, company, email, phone, status, notes, onboard_date, closed, category } = req.body as {
      name?: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string; onboard_date?: string | null; closed?: boolean; category?: string
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "status must be active, inactive, or archived" })
    }
    if (notes !== undefined) {
      const noteCheck = await checkNoteLength(orgId, notes)
      if (!noteCheck.allowed) return res.status(402).json(noteCheck)
    }
    const [before] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    const [updated] = await db
      .update(clients)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(category !== undefined ? { category: category.trim().slice(0, 60) } : {}),
        ...(onboard_date !== undefined ? { onboardDate: onboard_date } : {}),
        ...(closed !== undefined ? { closedAt: closed ? new Date() : null } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    if (closed !== undefined && (!!before?.closedAt !== !!updated.closedAt)) {
      await logAudit({ orgId, entityType: "client", entityId: id, action: closed ? "close" : "reopen", actorId: userId })
    } else {
      const changes = diffFields(
        before as Record<string, unknown>,
        updated as Record<string, unknown>,
        ["name", "company", "email", "phone", "status", "notes", "category", "onboardDate"],
      )
      if (Object.keys(changes).length) await logAudit({ orgId, entityType: "client", entityId: id, action: "update", actorId: userId, changes })
    }
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!requireBusinessFeature(res, ctx, "clients")) return
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // The own/internal company client is permanent — it anchors internal expenses.
    const [target] = await db
      .select({ isOwn: clients.isOwn })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    if (target?.isOwn) {
      return res.status(403).json({ error: "Your own company client can't be deleted." })
    }
    // Soft-delete the client AND its live transactions together, reversing each
    // transaction's wealth-balance effect so balances stay correct while the
    // client sits in Trash. They share one `deletedAt` so a later restore can
    // re-apply exactly these (and leave any individually-trashed-earlier tx alone).
    const now = new Date()
    const liveTx = await db
      .select({
        wealthAccountId: transactions.wealthAccountId,
        type: transactions.type,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt)))
    for (const [accountId, shift] of reversalsByAccount(liveTx)) {
      await db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedBy: userId, updatedAt: now })
        .where(eq(wealthAccounts.id, accountId))
    }
    if (liveTx.length) {
      await db
        .update(transactions)
        .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
        .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt)))
    }
    const [updated] = await db
      .update(clients)
      .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    await logAudit({ orgId, entityType: "client", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
