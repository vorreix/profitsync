import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { currentRate } from "../../_lib/fx-rates.js"
import { normalizeCurrencyCode } from "../../../src/lib/money.js"

/**
 * GET /api/fx/rate?from=EUR&to=INR — today's market rate for one pair.
 *
 * What the transfer form uses to suggest the amount that will arrive. It is a
 * SUGGESTION: a bank or remittance service rarely gives the market rate, so the
 * user can always overwrite it, and what the transfer stores is whatever they
 * actually got (api/_lib/wealth-accounts.ts transferAmounts derives the
 * effective rate from the two amounts, never from this).
 *
 * `stale` means the number is the newest observation we hold rather than
 * today's — the caller must say so rather than imply it is current. A pair with
 * no rate at all returns 404: the form then just asks for both amounts.
 *
 * Read-only apart from caching the observation it fetched.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  let from: string
  let to: string
  try {
    from = normalizeCurrencyCode(String(req.query.from ?? ""))
    to = normalizeCurrencyCode(String(req.query.to ?? ""))
  } catch {
    return res.status(400).json({ error: "from and to must be ISO currency codes", code: "invalid_currency" })
  }

  const rate = await currentRate(from, to).catch(() => null)
  if (!rate) return res.status(404).json({ error: "No exchange rate available for this pair", code: "no_rate" })
  return res.json({ from: rate.base, to: rate.quote, rate: rate.rate, rate_date: rate.rateDate, provider: rate.provider, stale: rate.stale })
}
