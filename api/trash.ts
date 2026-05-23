import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../src/lib/db"
import { clients, quotations } from "../src/lib/db/schema"
import { and, eq, isNotNull } from "drizzle-orm"

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! })
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [deletedClients, deletedQuotations] = await Promise.all([
    db.select().from(clients).where(and(eq(clients.userId, userId), isNotNull(clients.deletedAt))),
    db.select().from(quotations).where(and(eq(quotations.userId, userId), isNotNull(quotations.deletedAt))),
  ])

  return res.json({
    clients: deletedClients.map(serialize),
    quotations: deletedQuotations.map(serialize),
  })
}
