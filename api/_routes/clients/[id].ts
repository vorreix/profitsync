import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db"
import { clients } from "../../../src/lib/db/schema"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth"
import { checkNoteLength } from "../../_lib/quota"

const VALID_STATUSES = ["active", "inactive", "archived"]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx
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
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, company, email, phone, status, notes, onboard_date } = req.body as {
      name?: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string; onboard_date?: string | null
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "status must be active, inactive, or archived" })
    }
    if (notes !== undefined) {
      const noteCheck = await checkNoteLength(orgId, notes)
      if (!noteCheck.allowed) return res.status(402).json(noteCheck)
    }
    const [updated] = await db
      .update(clients)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(onboard_date !== undefined ? { onboardDate: onboard_date } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [updated] = await db
      .update(clients)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
