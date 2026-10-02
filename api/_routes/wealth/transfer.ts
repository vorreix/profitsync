import type { VercelRequest, VercelResponse } from "@vercel/node"
import { serialize } from "../../../src/lib/db/index.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { createTransfer, createTransferIntent } from "../../_lib/wealth-accounts.js"
import { resolveCardForLeg } from "../../_lib/cards.js"

/**
 * Move money between two of the org's wealth accounts — see
 * api/_lib/wealth-accounts.ts createTransfer for the money model (two legs,
 * one group_id, paying a credit card is a transfer INTO the card).
 *
 * `from_card_id` (optional) names the CARD used on the source side; the money
 * still leaves that card's own account, and the card is recorded on the
 * outgoing leg so the ledger shows "D •••• 1234".
 *
 *   • a DEBIT card is an instrument — the money leaves its bank;
 *   • a CREDIT card is a BALANCE TRANSFER — the money leaves its liability
 *     account, so the payer's debt goes up as the payee's goes down and net
 *     worth does not move. Nothing was paid off, only moved, which is why
 *     autopay refuses this combination (api/_lib/card-autopay.ts).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { from_account_id, to_account_id, amount, source_amount, destination_amount, source_fee_amount, source_currency, destination_currency, status, date, note, from_card_id } = req.body as {
    from_account_id?: string
    to_account_id?: string
    amount?: number | string
    source_amount?: number | string
    destination_amount?: number | string
    source_fee_amount?: number | string
    source_currency?: string
    destination_currency?: string
    status?: string
    date?: string
    note?: string
    from_card_id?: string | null
  }

  if (status && !["planned", "pending", "completed"].includes(status)) {
    return res.status(400).json({ error: "status must be planned, pending, or completed", code: "invalid_transfer_status" })
  }

  let fromAccountId = from_account_id ?? ""
  let fromCardId: string | null = null
  if (from_card_id) {
    const resolved = await resolveCardForLeg(orgId, from_card_id, from_account_id)
    if (!resolved.ok) return res.status(400).json({ error: resolved.error })
    fromAccountId = resolved.accountId
    fromCardId = resolved.card.id
  }

  // createTransfer already refuses from === to, but say it in card terms when
  // the caller used a card id (the accounts would look unrelated otherwise).
  if (fromCardId && to_account_id && fromAccountId === to_account_id) {
    return res.status(400).json({ error: "A card can't pay itself", code: "funding_self" })
  }

  const input = {
    fromAccountId,
    toAccountId: to_account_id ?? "",
    amount,
    sourceAmount: source_amount,
    destinationAmount: destination_amount,
    sourceFeeAmount: source_fee_amount,
    sourceCurrency: source_currency,
    destinationCurrency: destination_currency,
    date,
    note,
    fromCardId,
  }
  if (status === "planned" || status === "pending") {
    const intent = await createTransferIntent(orgId, userId, input, status)
    if (!intent.ok) return res.status(intent.status).json(intent.body)
    return res.status(201).json(serialize(intent.row))
  }
  const result = await createTransfer(orgId, userId, input)
  if (!result.ok) return res.status(result.status).json(result.body)

  return res.status(201).json({ transfer_id: result.transferId, group_id: result.groupId, from_leg: serialize(result.outLeg), to_leg: serialize(result.inLeg), fee_leg: result.feeLeg ? serialize(result.feeLeg) : null, attach_to: result.outLeg.id })
}
