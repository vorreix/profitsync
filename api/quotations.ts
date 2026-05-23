import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../src/lib/db"
import { quotations } from "../src/lib/db/schema"
import { and, eq, desc, isNull } from "drizzle-orm"

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"]

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
      .from(quotations)
      .where(and(eq(quotations.userId, userId), isNull(quotations.deletedAt)))
      .orderBy(desc(quotations.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const { title, prospect_name, company, email, phone, amount, status, notes } = req.body as {
      title: string; prospect_name: string; company?: string; email?: string
      phone?: string; amount?: number; status?: string; notes?: string
    }
    if (!title?.trim()) return res.status(400).json({ error: "title is required" })
    if (!prospect_name?.trim()) return res.status(400).json({ error: "prospect_name is required" })
    const normalizedStatus = status ?? "draft"
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ error: "status must be draft, sent, accepted, or rejected" })
    }
    const [row] = await db
      .insert(quotations)
      .values({
        userId,
        title: title.trim(),
        prospectName: prospect_name.trim(),
        company: company ?? "",
        email: email ?? "",
        phone: phone ?? "",
        amount: amount != null ? String(amount) : "0",
        status: normalizedStatus,
        notes: notes ?? "",
      })
      .returning()
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
