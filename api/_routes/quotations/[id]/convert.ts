import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { clients, quotations } from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth, requireBusinessFeature } from "../../../_lib/auth.js"
import { notifyQuotationAccepted } from "../../../_lib/notify-quotation.js"
import { checkClientQuota } from "../../../_lib/quota.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { userId, orgId, role } = ctx
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { id } = req.query as { id: string }

  const [quotation] = await db
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
  if (!quotation) return res.status(404).json({ error: "Not found" })
  if (quotation.linkedClientId) {
    return res.status(409).json({ error: "Quotation already converted to a client" })
  }

  const quota = await checkClientQuota(orgId)
  if (!quota.allowed) return res.status(402).json(quota)

  const [newClient] = await db
    .insert(clients)
    .values({
      userId,
      organizationId: orgId,
      name: quotation.prospectName,
      company: quotation.company ?? "",
      email: quotation.email ?? "",
      phone: quotation.phone ?? "",
      status: "active",
      notes: quotation.notes ?? "",
    })
    .returning()

  await db
    .update(quotations)
    .set({ linkedClientId: newClient.id, status: "accepted", updatedAt: new Date() })
    .where(eq(quotations.id, id))

  // Converting implies acceptance — the shared dedupe key collapses this with a
  // prior explicit accept, so accept-then-convert notifies exactly once.
  void notifyQuotationAccepted(
    orgId,
    { id: quotation.id, title: quotation.title, userId: quotation.userId },
    userId,
  ).catch(() => {})

  return res.status(201).json(serialize(newClient))
}
