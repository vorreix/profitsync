import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { wealthAccounts } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { getOrgPlan } from "../../_lib/quota.js"

/**
 * GET /api/wealth/quota — the org's bank-account allowance, so the UI can gate
 * the Add-Account entry points up front (crown badge + upgrade dialog) instead
 * of letting the user fill the form and then hit the server's 402.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [{ planKey, limits }, [{ current }], [{ spaceCurrent }]] = await Promise.all([
    getOrgPlan(ctx.orgId),
    db
      .select({ current: count() })
      .from(wealthAccounts)
      .where(
        and(
          eq(wealthAccounts.organizationId, ctx.orgId),
          eq(wealthAccounts.type, "bank"),
          isNull(wealthAccounts.archivedAt),
        ),
      ),
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
    plan_key: planKey,
    bank_accounts: { current, limit: limits.bankAccounts },
    spaces: { current: spaceCurrent, limit: limits.spaces },
  })
}
