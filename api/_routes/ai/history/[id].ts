import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { aiAsks } from "../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../_lib/auth.js"

// DELETE /api/ai/history/:id — remove one of the user's own asks.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" })

  const id = (req.query.id as string) ?? ""
  if (!id) return res.status(400).json({ error: "id is required" })

  await db
    .delete(aiAsks)
    .where(and(eq(aiAsks.id, id), eq(aiAsks.organizationId, ctx.orgId), eq(aiAsks.userId, ctx.userId)))
  return res.status(204).end()
}
