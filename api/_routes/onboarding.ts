import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, organizations, transactions, userProfiles, wealthAccounts } from "../../src/lib/db/schema.js"
import { createOrgForUser, ensurePersonalOrg, getUserId } from "../_lib/auth.js"
import { parseOrgCurrency, setOrgCurrency } from "../_lib/org-currency.js"
import { DEFAULT_CASH_NAME } from "../_lib/wealth-accounts.js"

/**
 * Onboarding asks "what currency?" and then which cash you hold — but Cash in
 * Hand is provisioned on the first /api/wealth/accounts read, which may have
 * happened before this choice (an earlier visit, a factory reset) and stamped
 * the OLD currency on it. Relabel it only while it is untouched: no row, no
 * rule, nothing in it. Anything with history keeps its label (an account's
 * currency is locked once money moved — see wealth/accounts/[id].ts).
 */
async function relabelUntouchedCash(orgId: string, code: string) {
  await db
    .update(wealthAccounts)
    .set({ currencyCode: code, updatedAt: new Date() })
    .where(
      and(
        eq(wealthAccounts.organizationId, orgId),
        eq(wealthAccounts.type, "cash"),
        eq(wealthAccounts.bankName, DEFAULT_CASH_NAME),
        isNull(wealthAccounts.archivedAt),
        sql`${wealthAccounts.currencyCode} is distinct from ${code}`,
        sql`${wealthAccounts.currentBalance} = 0 and ${wealthAccounts.openingBalance} = 0`,
        sql`not exists (select 1 from transactions t where t.wealth_account_id = ${wealthAccounts.id})`,
        sql`not exists (select 1 from recurring_rules r where ${wealthAccounts.id} in (r.wealth_account_id, r.to_account_id, r.debt_account_id))`,
      ),
    )
}

/**
 * Give a workspace that ALREADY exists the chosen currency — only while it holds
 * no ledger row (trashed included). The picker defaults to the timezone's guess,
 * and a factory reset of one workspace re-runs onboarding for its owner, whose
 * choice may then land on their OTHER, live workspace: every member's figures
 * would switch to that guess. A workspace with history keeps its currency (org
 * settings change it on purpose). Returns whether it now reports in `code`.
 */
async function adoptCurrencyIfEmpty(orgId: string, code: string | undefined, actorId: string): Promise<boolean> {
  if (!code) return false
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .where(eq(clients.organizationId, orgId))
    .limit(1)
  if (row) return false
  await setOrgCurrency(orgId, code, { actorId })
  return true
}

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
  const resolvedCurrency = currency === undefined ? undefined : parseOrgCurrency(currency)
  if (resolvedCurrency === null) {
    return res.status(400).json({ error: "Invalid currency code", code: "invalid_currency" })
  }

  let orgId: string
  let adopted = false // the workspace now reports in resolvedCurrency

  if (account_type === "personal") {
    // Ensures account_type=personal + a default client.
    orgId = await ensurePersonalOrg(userId)
    adopted = await adoptCurrencyIfEmpty(orgId, resolvedCurrency, userId)
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
      adopted = await adoptCurrencyIfEmpty(orgId, resolvedCurrency, userId)
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
      adopted = !!resolvedCurrency
    }
  }

  if (adopted && resolvedCurrency) await relabelUntouchedCash(orgId, resolvedCurrency)

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
