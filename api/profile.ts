import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient, verifyToken } from "@clerk/backend"
import { db, serialize } from "../src/lib/db"
import { userProfiles } from "../src/lib/db/schema"
import { eq } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

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
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))

    if (!profile) {
      const clerkUser = await clerk.users.getUser(userId)
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? ""
      const [created] = await db
        .insert(userProfiles)
        .values({ id: userId, email, fullName: clerkUser.fullName ?? "" })
        .returning()
      return res.json(serialize(created))
    }

    return res.json(serialize(profile))
  }

  if (req.method === "PATCH") {
    const { full_name, currency } = req.body as { full_name?: string; currency?: string }
    const [updated] = await db
      .update(userProfiles)
      .set({
        ...(full_name !== undefined ? { fullName: full_name } : {}),
        ...(currency !== undefined ? { currency } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, userId))
      .returning()
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
