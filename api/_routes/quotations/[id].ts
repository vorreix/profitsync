import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { quotations } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { checkNoteLength } from "../../_lib/quota.js"
import { diffFields, logAudit } from "../../_lib/audit.js"

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"]

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const [row] = await db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
    if (!row) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(row))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { title, prospect_name, company, email, phone, amount, date, status, notes, closed, category } = req.body as {
      title?: string; prospect_name?: string; company?: string; email?: string
      phone?: string; amount?: number; date?: string; status?: string; notes?: string; closed?: boolean; category?: string
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "status must be draft, sent, accepted, or rejected" })
    }
    if (notes !== undefined) {
      const noteCheck = await checkNoteLength(orgId, notes)
      if (!noteCheck.allowed) return res.status(402).json(noteCheck)
    }
    const [before] = await db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
    const [updated] = await db
      .update(quotations)
      .set({
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(prospect_name !== undefined ? { prospectName: prospect_name.trim() } : {}),
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(isIsoDate(date) ? { date } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(category !== undefined ? { category: category.trim().slice(0, 60) } : {}),
        ...(closed !== undefined ? { closedAt: closed ? new Date() : null } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    if (closed !== undefined && (!!before?.closedAt !== !!updated.closedAt)) {
      await logAudit({ orgId, entityType: "quotation", entityId: id, action: closed ? "close" : "reopen", actorId: userId })
    } else {
      const changes = diffFields(
        before as Record<string, unknown>,
        updated as Record<string, unknown>,
        ["title", "prospectName", "company", "email", "phone", "amount", "status", "notes", "category"],
      )
      if (Object.keys(changes).length) await logAudit({ orgId, entityType: "quotation", entityId: id, action: "update", actorId: userId, changes })
    }
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [updated] = await db
      .update(quotations)
      .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    await logAudit({ orgId, entityType: "quotation", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
