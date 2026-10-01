import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sql } from "drizzle-orm"
import { requireAuth } from "../../_lib/auth.js"
import { currentRate } from "../../_lib/fx-rates.js"
import { rateLimit } from "../../_lib/rate-limit.js"
import { db } from "../../../src/lib/db/index.js"
import { normalizeCurrencyCode } from "../../../src/lib/money.js"

/** Per user, per instance: the transfer form and the budget hint ask once per pair change. */
const RATE_LIMIT = { max: 60, windowMs: 60_000 }

/**
 * The currencies this workspace actually uses: its reporting currency, its
 * accounts (incl. archived, debts, Spaces) and its budgets. Only a pair made of
 * these may make the server ask a provider (MC-169).
 */
async function orgCurrencies(orgId: string): Promise<Set<string>> {
  const res = await db.execute(sql`
    select coalesce(reporting_currency, currency) as cur from organizations where id = ${orgId}
    union select currency_code from wealth_accounts where organization_id = ${orgId}
    union select currency_code from spending_budgets where organization_id = ${orgId}
    union select currency_code from budgets where organization_id = ${orgId}
  `)
  return new Set((res.rows as Array<{ cur: string | null }>).filter((r) => r.cur).map((r) => String(r.cur).toUpperCase()))
}

/**
 * GET /api/fx/rate?from=EUR&to=INR — today's market rate for one pair.
 *
 * What the transfer form uses to suggest the amount that will arrive. It is a
 * SUGGESTION: a bank or remittance service rarely gives the market rate, so the
 * user can always overwrite it, and what the transfer stores is whatever they
 * actually got (api/_lib/wealth-accounts.ts transferAmounts derives the
 * effective rate from the two amounts, never from this).
 *
 * `rate_date` is the day the rate was observed; `stale` means it is older than
 * a normal publication lag — the caller must say so rather than imply it is
 * current. A pair with no rate at all returns 404: the form then just asks for
 * both amounts.
 *
 * The rate table is shared by every workspace, so this route never stores what
 * a client sends: a provider is asked (and its answer cached) only for a pair
 * of currencies this workspace uses; any other pair is answered from the store
 * alone. Rate-limited per user.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  if (!rateLimit(`fx-rate:${ctx.userId}`, RATE_LIMIT.max, RATE_LIMIT.windowMs)) {
    return res.status(429).json({ error: "Too many exchange-rate requests — try again in a minute", code: "rate_limited" })
  }

  let from: string
  let to: string
  try {
    from = normalizeCurrencyCode(String(req.query.from ?? ""))
    to = normalizeCurrencyCode(String(req.query.to ?? ""))
  } catch {
    return res.status(400).json({ error: "from and to must be ISO currency codes", code: "invalid_currency" })
  }

  const used = await orgCurrencies(ctx.orgId)
  const rate = await currentRate(from, to, { refresh: used.has(from) && used.has(to) }).catch(() => null)
  if (!rate) return res.status(404).json({ error: "No exchange rate available for this pair", code: "no_rate" })
  return res.json({ from: rate.base, to: rate.quote, rate: rate.rate, rate_date: rate.rateDate, provider: rate.provider, stale: rate.stale })
}
