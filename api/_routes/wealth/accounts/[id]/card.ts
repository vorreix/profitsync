import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../../../src/lib/db/index.js"
import { wealthAccounts } from "../../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../../_lib/auth.js"
import { loadCardSummary } from "../../../../_lib/credit-card.js"
import { isLiabilityType } from "../../../../../src/lib/credit-card.js"
import { logoDataUrl } from "../../../../../src/lib/logo-data.js"

/**
 * GET /api/wealth/accounts/:id/card — the credit-card view of one account:
 * amount owed / card credit / available credit, the latest filed statement
 * (balance, paid, remaining, textual status), older statements, and the open
 * cycle's spend / refunds / payments with its closing and due dates. Files any
 * statement whose closing date has passed before answering. Read-only; paying
 * the card is POST /api/wealth/transfer with the card as the destination.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { id } = req.query as { id: string }

  const [account] = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, ctx.orgId)))
  if (!account) return res.status(404).json({ error: "Not found" })
  if (!isLiabilityType(account.type)) return res.status(400).json({ error: "Not a credit card" })

  const summary = await loadCardSummary(account)
  const { logoData, ...safe } = account
  return res.json({
    account: serialize({ ...safe, logoSrc: logoDataUrl(logoData) }),
    ...summary,
  })
}
