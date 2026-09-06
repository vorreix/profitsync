import type { VercelRequest, VercelResponse } from "@vercel/node"
import { serialize } from "../../../src/lib/db/index.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { createTransfer } from "../../_lib/wealth-accounts.js"
import { resolveCardForLeg } from "../../_lib/cards.js"

/**
 * Move money between two of the org's wealth accounts — see
 * api/_lib/wealth-accounts.ts createTransfer for the money model (two legs,
 * one group_id, paying a credit card is a transfer INTO the card).
 *
 * `from_card_id` (optional) names the DEBIT card used on the source side: the
 * money still leaves `from_account_id` (which must be that card's bank); the
 * card is recorded on the outgoing leg so the ledger shows "D •••• 1234".
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { from_account_id, to_account_id, amount, date, note, from_card_id } = req.body as {
    from_account_id?: string
    to_account_id?: string
    amount?: number | string
    date?: string
    note?: string
    from_card_id?: string | null
  }

  let fromAccountId = from_account_id ?? ""
  let fromCardId: string | null = null
  if (from_card_id) {
    const resolved = await resolveCardForLeg(orgId, from_card_id, from_account_id)
    if (!resolved.ok) return res.status(400).json({ error: resolved.error })
    if (resolved.card.kind !== "debit") return res.status(400).json({ error: "Only a debit card can pay a transfer — a credit card is paid, not paid from" })
    fromAccountId = resolved.accountId
    fromCardId = resolved.card.id
  }

  const result = await createTransfer(orgId, userId, {
    fromAccountId,
    toAccountId: to_account_id ?? "",
    amount: Number(amount),
    date,
    note,
    fromCardId,
  })
  if (!result.ok) return res.status(result.status).json(result.body)

  return res.status(201).json({ group_id: result.groupId, from_leg: serialize(result.outLeg), to_leg: serialize(result.inLeg), attach_to: result.outLeg.id })
}
