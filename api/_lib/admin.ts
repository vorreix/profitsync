import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db"
import { appAdmins } from "../../src/lib/db/schema"
import { getUserId } from "./auth"

export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const userId = await getUserId(req)
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }
  const [row] = await db.select().from(appAdmins).where(eq(appAdmins.userId, userId))
  if (!row) {
    res.status(403).json({ error: "Forbidden" })
    return null
  }
  return userId
}

export async function isAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select().from(appAdmins).where(eq(appAdmins.userId, userId))
  return !!row
}
