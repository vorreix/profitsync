import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { eq } from "drizzle-orm"
import { CURRENCY_LIST } from "../src/lib/currencies"
import { SUPPORTED_LANGUAGE_CODES } from "../src/lib/i18n/languages"
import { db, serialize } from "../src/lib/db"
import { userProfiles } from "../src/lib/db/schema"
import { ensurePersonalOrg, getUserId } from "./_lib/auth"

const VALID_CURRENCIES = new Set(CURRENCY_LIST.map((c) => c.code))
const VALID_LANGUAGES = new Set(SUPPORTED_LANGUAGE_CODES)

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

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
      // Insert profile first so ensurePersonalOrg can read the (still default) currency.
      const [created] = await db
        .insert(userProfiles)
        .values({ id: userId, email, fullName: clerkUser.fullName ?? "" })
        .returning()
      const personalOrgId = await ensurePersonalOrg(userId)
      const [updated] = await db
        .update(userProfiles)
        .set({ currentOrganizationId: personalOrgId, updatedAt: new Date() })
        .where(eq(userProfiles.id, userId))
        .returning()
      return res.json(serialize(updated ?? created))
    }

    if (!profile.currentOrganizationId) {
      const personalOrgId = await ensurePersonalOrg(userId)
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
    const { full_name, currency, language } = req.body as { full_name?: string; currency?: string; language?: string }
    if (currency !== undefined && !VALID_CURRENCIES.has(currency)) {
      return res.status(400).json({ error: "Invalid currency code" })
    }
    if (language !== undefined && !VALID_LANGUAGES.has(language)) {
      return res.status(400).json({ error: "Invalid language code" })
    }
    const [updated] = await db
      .update(userProfiles)
      .set({
        ...(full_name !== undefined ? { fullName: full_name } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(language !== undefined ? { language } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, userId))
      .returning()
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
