import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { organizations, wealthAccounts } from "../../../src/lib/db/schema.js"
import { ensurePersonalOrg, getUserFamilyOrgId, getUserId } from "../../_lib/auth.js"

// GET /api/family/accounts — accounts the caller can pick in a family transfer:
//   personal: their OWN spendable accounts (bank/cash) — the contribution source
//   family:   the shared household accounts + family spaces — the destination
// Both are already visible to the caller, so no privacy boundary is crossed.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const familyOrgId = await getUserFamilyOrgId(userId)
  if (!familyOrgId) return res.status(400).json({ error: "You're not part of a family yet.", code: "no_family" })

  const personalOrgId = await ensurePersonalOrg(userId)
  const [familyOrg] = await db
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, familyOrgId))
  const [personalOrg] = await db
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, personalOrgId))

  const cols = {
    id: wealthAccounts.id,
    type: wealthAccounts.type,
    nickname: wealthAccounts.nickname,
    bankName: wealthAccounts.bankName,
    icon: wealthAccounts.icon,
    currentBalance: wealthAccounts.currentBalance,
    isDefault: wealthAccounts.isDefault,
  }

  // Personal source: spendable accounts only (you contribute FROM bank/cash).
  const personal = await db
    .select(cols)
    .from(wealthAccounts)
    .where(
      and(
        eq(wealthAccounts.organizationId, personalOrgId),
        isNull(wealthAccounts.archivedAt),
        eq(wealthAccounts.type, "bank"),
      ),
    )
    .orderBy(asc(wealthAccounts.position))
  const personalCash = await db
    .select(cols)
    .from(wealthAccounts)
    .where(
      and(
        eq(wealthAccounts.organizationId, personalOrgId),
        isNull(wealthAccounts.archivedAt),
        eq(wealthAccounts.type, "cash"),
      ),
    )

  // Family destination: shared accounts AND family spaces.
  const family = await db
    .select(cols)
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, familyOrgId), isNull(wealthAccounts.archivedAt)))
    .orderBy(asc(wealthAccounts.position))

  return res.json({
    personal_currency: personalOrg?.currency ?? "USD",
    family_currency: familyOrg?.currency ?? "USD",
    personal: [...personalCash, ...personal].map(serialize),
    family: family.map(serialize),
  })
}
