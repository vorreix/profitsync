import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq } from "drizzle-orm"
import { CURRENCY_LIST } from "../../src/lib/currencies.js"
import { db } from "../../src/lib/db/index.js"
import { organizations, userProfiles } from "../../src/lib/db/schema.js"
import { createOrgForUser, ensurePersonalOrg, getUserId } from "../_lib/auth.js"

const VALID_CURRENCIES = new Set(CURRENCY_LIST.map((c) => c.code))

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "company"
  )
}

/**
 * Complete the Personal/Business onboarding choice.
 *
 * - personal: keep the user in their personal workspace (account_type=personal)
 * - business: reuse the user's existing business workspace, or create one
 *
 * Switches the user's active org to the chosen workspace and stamps
 * `onboarded_at` so the onboarding screen is not shown again.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { account_type, company_name, currency } = req.body as {
    account_type?: string
    company_name?: string
    currency?: string
  }
  if (account_type !== "personal" && account_type !== "business") {
    return res.status(400).json({ error: "account_type must be 'personal' or 'business'" })
  }
  const resolvedCurrency = currency?.toUpperCase()
  if (resolvedCurrency !== undefined && !VALID_CURRENCIES.has(resolvedCurrency)) {
    return res.status(400).json({ error: "Invalid currency code" })
  }

  let orgId: string

  if (account_type === "personal") {
    // Ensures account_type=personal + a default client.
    orgId = await ensurePersonalOrg(userId)
    if (resolvedCurrency) {
      await db.update(organizations).set({ currency: resolvedCurrency, updatedAt: new Date() }).where(eq(organizations.id, orgId))
    }
  } else {
    // Reuse the user's existing business workspace if they have one.
    const [existingBiz] = await db
      .select({ id: organizations.id, accountType: organizations.accountType })
      .from(organizations)
      .where(and(eq(organizations.ownerUserId, userId), eq(organizations.isPersonal, false)))
      .orderBy(asc(organizations.createdAt))
      .limit(1)

    if (existingBiz) {
      orgId = existingBiz.id
      if (existingBiz.accountType !== "business") {
        await db.update(organizations).set({ accountType: "business", updatedAt: new Date() }).where(eq(organizations.id, orgId))
      }
      if (resolvedCurrency) {
        await db.update(organizations).set({ currency: resolvedCurrency, updatedAt: new Date() }).where(eq(organizations.id, orgId))
      }
    } else {
      const name = company_name?.trim() || "My Company"
      const created = await createOrgForUser({
        userId,
        name,
        slug: slugify(name),
        isPersonal: false,
        accountType: "business",
        currency: resolvedCurrency,
      })
      orgId = created.id
    }
  }

  // Switch active org + mark onboarding complete.
  await db
    .update(userProfiles)
    .set({
      currentOrganizationId: orgId,
      onboardedAt: new Date(),
      ...(resolvedCurrency ? { currency: resolvedCurrency } : {}),
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.id, userId))

  return res.json({ organization_id: orgId, account_type })
}
