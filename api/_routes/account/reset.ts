import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { resetOrgData } from "../../_lib/account-reset.js"

/**
 * Factory-reset the active organization's financial data (accounts, wallets,
 * transactions, trash/history, budgets, recurring rules, categories, tags),
 * keeping auth/session, membership and billing intact. Owner-only: a full wipe
 * of a workspace's money is an owner-level action.
 *
 * The client gates this behind a typed-confirmation dialog (ResetDataDialog);
 * the owner check here is the real enforcement.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (role !== "owner") return res.status(403).json({ error: "Only the workspace owner can reset all data" })

  const result = await resetOrgData(orgId, userId)
  return res.json({ ok: true, ...result })
}
