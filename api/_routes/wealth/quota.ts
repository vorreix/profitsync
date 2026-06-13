import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { wealthAccounts } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { bankAccountUsage, getOrgPlan } from "../../_lib/quota.js"

/**
 * GET /api/wealth/quota — the org's bank-account allowance, so the UI can gate
 * the Add-Account entry points up front (crown badge + upgrade dialog) instead
 * of letting the user fill the form and then hit the server's 402.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [{ limits }, bank, [{ spaceCurrent }]] = await Promise.all([
    getOrgPlan(ctx.orgId),
    // Bank count that matches the limit semantics: free = active only, paid = total
    // including closed (since paid allows up to 20 including closed).
    bankAccountUsage(ctx.orgId),
    db
      .select({ spaceCurrent: count() })
      .from(wealthAccounts)
      .where(
        and(
          eq(wealthAccounts.organizationId, ctx.orgId),
          eq(wealthAccounts.type, "space"),
          isNull(wealthAccounts.archivedAt),
        ),
      ),
  ])

  return res.json({
    plan_key: bank.planKey,
    bank_accounts: { current: bank.current, limit: bank.limit },
    spaces: { current: spaceCurrent, limit: limits.spaces },
  })
}
