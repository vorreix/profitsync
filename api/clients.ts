import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../src/lib/db"
import { clients } from "../src/lib/db/schema"
import { eq, desc } from "drizzle-orm"

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

  if (req.method === "GET") {
    const rows = await db
      .select()
      .from(clients)
      .where(eq(clients.userId, userId))
      .orderBy(desc(clients.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const { name, company, email, phone, status, notes } = req.body as {
      name: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string
    }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    const [row] = await db
      .insert(clients)
      .values({ userId, name, company: company ?? "", email: email ?? "", phone: phone ?? "", status: status ?? "active", notes: notes ?? "" })
      .returning()
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
