import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { eq } from "drizzle-orm"
import { CURRENCY_LIST } from "../../src/lib/currencies.js"
import { SUPPORTED_LANGUAGE_CODES } from "../../src/lib/i18n/languages.js"
import { db, serialize } from "../../src/lib/db/index.js"
import { userProfiles } from "../../src/lib/db/schema.js"
import { ensurePersonalOrg, getUserId } from "../_lib/auth.js"
import { attributeReferral } from "../_lib/referral.js"

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
      // Attribute a referral if the signup carried a code (?r=… → unsafeMetadata).
      const referralCode = (clerkUser.unsafeMetadata as { referralCode?: string } | undefined)?.referralCode
      if (referralCode) await attributeReferral(userId, referralCode)
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
      if (!updated) return res.status(404).json({ error: "Profile not found" })
      return res.json(serialize(updated))
    }

    return res.json(serialize(profile))
  }

  if (req.method === "PATCH") {
    const {
      full_name, currency, language, company_upsell_dismissed_at, company_upsell_hidden,
      address, city, state, postal_code, country, phone_country_code, phone,
    } = req.body as {
      full_name?: string
      currency?: string
      language?: string
      company_upsell_dismissed_at?: string | null
      company_upsell_hidden?: boolean
      address?: string
      city?: string
      state?: string
      postal_code?: string
      country?: string
      phone_country_code?: string
      phone?: string
    }
    if (currency !== undefined && !VALID_CURRENCIES.has(currency)) {
      return res.status(400).json({ error: "Invalid currency code" })
    }
    if (language !== undefined && !VALID_LANGUAGES.has(language)) {
      return res.status(400).json({ error: "Invalid language code" })
    }
    // Optional free-form contact fields — never required; only trimmed + capped.
    const str = (v: string | undefined, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined)
    const [updated] = await db
      .update(userProfiles)
      .set({
        ...(full_name !== undefined ? { fullName: full_name } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(language !== undefined ? { language } : {}),
        ...(company_upsell_dismissed_at !== undefined
          ? { companyUpsellDismissedAt: company_upsell_dismissed_at ? new Date(company_upsell_dismissed_at) : null }
          : {}),
        ...(company_upsell_hidden !== undefined ? { companyUpsellHidden: company_upsell_hidden } : {}),
        ...(address !== undefined ? { address: str(address, 300) } : {}),
        ...(city !== undefined ? { city: str(city, 120) } : {}),
        ...(state !== undefined ? { state: str(state, 120) } : {}),
        ...(postal_code !== undefined ? { postalCode: str(postal_code, 30) } : {}),
        ...(country !== undefined ? { country: str(country, 2) } : {}),
        ...(phone_country_code !== undefined ? { phoneCountryCode: str(phone_country_code, 8) } : {}),
        ...(phone !== undefined ? { phone: str(phone, 32) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, userId))
      .returning()
    if (!updated) return res.status(404).json({ error: "Profile not found" })
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
