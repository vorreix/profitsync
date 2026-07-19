import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { aiAsks } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// /api/ai/history — the user's voice-assistant ask log for the active org.
// GET lists the latest asks; DELETE clears ALL of them. Per-item deletion is
// handled by [id].ts. History is display-only for the USER — it is never fed
// back into the model (see api/_lib/ai.ts).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  const scope = and(eq(aiAsks.organizationId, ctx.orgId), eq(aiAsks.userId, ctx.userId))

  if (req.method === "GET") {
    const rows = await db.select().from(aiAsks).where(scope).orderBy(desc(aiAsks.createdAt)).limit(30)
    return res.json(rows.map(serialize))
  }

  if (req.method === "DELETE") {
    await db.delete(aiAsks).where(scope)
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
