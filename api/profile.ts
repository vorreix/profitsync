import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { and, eq } from "drizzle-orm"
import { CURRENCY_LIST } from "../src/lib/currencies"
import { db, serialize } from "../src/lib/db"
import {
  organizationMembers,
  organizations,
  userProfiles,
} from "../src/lib/db/schema"
import { getUserId } from "./_lib/auth"

const VALID_CURRENCIES = new Set(CURRENCY_LIST.map((c) => c.code))

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function ensurePersonalOrgForUser(userId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.ownerUserId, userId), eq(organizations.isPersonal, true)))
  if (existing) return existing.id

  const [created] = await db
    .insert(organizations)
    .values({ ownerUserId: userId, name: "Personal", slug: "personal", isPersonal: true })
    .returning()
  await db.insert(organizationMembers).values({
    organizationId: created.id,
    userId,
    role: "owner",
  })
  return created.id
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "GET") {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))

    if (!profile) {
      const clerkUser = await clerk.users.getUser(userId)
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? ""
      const personalOrgId = await ensurePersonalOrgForUser(userId)
      const [created] = await db
        .insert(userProfiles)
        .values({
          id: userId,
          email,
          fullName: clerkUser.fullName ?? "",
          currentOrganizationId: personalOrgId,
        })
        .returning()
      return res.json(serialize(created))
    }

    // Ensure profile has a current org pointer (covers older accounts)
    if (!profile.currentOrganizationId) {
      const personalOrgId = await ensurePersonalOrgForUser(userId)
      const [updated] = await db
        .update(userProfiles)
        .set({ currentOrganizationId: personalOrgId, updatedAt: new Date() })
        .where(eq(userProfiles.id, userId))
        .returning()
      return res.json(serialize(updated))
    }

    return res.json(serialize(profile))
  }

  if (req.method === "PATCH") {
    const { full_name, currency } = req.body as { full_name?: string; currency?: string }
    if (currency !== undefined && !VALID_CURRENCIES.has(currency)) {
      return res.status(400).json({ error: "Invalid currency code" })
    }
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
