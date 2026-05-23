import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { db, serialize } from "../../src/lib/db"
import { clients } from "../../src/lib/db/schema"
import { and, eq } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await clerk.verifyToken(token)
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const [row] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.userId, userId)))
    if (!row) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(row))
  }

  if (req.method === "PATCH") {
    const { name, company, email, phone, status, notes } = req.body as {
      name?: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string
    }
    const [updated] = await db
      .update(clients)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, id), eq(clients.userId, userId)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    await db
      .delete(clients)
      .where(and(eq(clients.id, id), eq(clients.userId, userId)))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
