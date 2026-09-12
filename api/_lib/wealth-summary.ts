// The consolidated wealth picture: native totals per currency, each account's
// approximate value in the reporting currency, assets, liabilities and net
// worth — with the rate date and an honest `complete` flag. Native balances are
// never changed by a rate; only the converted column moves.
//
// Read-only. The one side effect is filling the FX snapshot table.
import { and, eq, isNull } from "drizzle-orm"
import Decimal from "decimal.js"
import { db } from "../../src/lib/db/index.js"
import { wealthAccounts } from "../../src/lib/db/schema.js"
import { cardCredit, cardDebt, isLiabilityType } from "../../src/lib/credit-card.js"
import type { WealthSummary, WealthSummaryAccount, WealthSummaryCurrency } from "../../src/lib/types.js"
import { convertAmount, currentRate, ensureRatesForOrg, reportingCurrencyFor, type RateLookup } from "./fx-rates.js"

const num2 = (d: Decimal) => d.toDecimalPlaces(2).toNumber()

export async function buildWealthSummary(orgId: string): Promise<WealthSummary> {
  const reporting = await reportingCurrencyFor(orgId)
  const rows = await db
    .select({
      id: wealthAccounts.id,
      type: wealthAccounts.type,
      bankName: wealthAccounts.bankName,
      nickname: wealthAccounts.nickname,
      currencyCode: wealthAccounts.currencyCode,
      currentBalance: wealthAccounts.currentBalance,
    })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))

  // Rates: best effort, then one lookup per foreign currency.
  await ensureRatesForOrg(orgId, reporting).catch(() => undefined)
  const currencies = [...new Set(rows.map((r) => (r.currencyCode ?? reporting).toUpperCase()))]
  const rates = new Map<string, RateLookup | null>()
  for (const cur of currencies) rates.set(cur, cur === reporting ? { base: cur, quote: reporting, rate: "1", rateDate: new Date().toISOString().slice(0, 10), provider: "identity", stale: false } : await currentRate(cur, reporting).catch(() => null))

  const accounts: WealthSummaryAccount[] = rows.map((r) => {
    const cur = (r.currencyCode ?? reporting).toUpperCase()
    const rate = rates.get(cur) ?? null
    const native = new Decimal(r.currentBalance)
    return {
      id: r.id,
      type: r.type,
      name: r.nickname.trim() || r.bankName,
      currency: cur,
      native_balance: num2(native),
      converted_balance: rate ? num2(convertAmount(native, rate)) : null,
      rate: rate?.rate ?? null,
      rate_date: rate?.rateDate ?? null,
      stale: rate?.stale ?? false,
    }
  })

  // Per-currency native totals, then converted.
  const byCurrency: WealthSummaryCurrency[] = []
  let convertedAssets = new Decimal(0)
  let convertedLiabilities = new Decimal(0)
  const excluded: string[] = []
  let asOf: string | null = null
  let stale = false
  for (const cur of currencies) {
    let assets = new Decimal(0)
    let liabilities = new Decimal(0)
    for (const r of rows) {
      if ((r.currencyCode ?? reporting).toUpperCase() !== cur) continue
      const bal = Number(r.currentBalance)
      if (isLiabilityType(r.type)) {
        liabilities = liabilities.plus(cardDebt(bal))
        assets = assets.plus(cardCredit(bal))
      } else {
        assets = assets.plus(bal)
      }
    }
    const rate = rates.get(cur) ?? null
    const entry: WealthSummaryCurrency = {
      currency: cur,
      assets: num2(assets),
      liabilities: num2(liabilities),
      net: num2(assets.minus(liabilities)),
      converted_assets: rate ? num2(convertAmount(assets, rate)) : null,
      converted_liabilities: rate ? num2(convertAmount(liabilities, rate)) : null,
      converted_net: rate ? num2(convertAmount(assets.minus(liabilities), rate)) : null,
      rate: rate?.rate ?? null,
      rate_date: rate?.rateDate ?? null,
      stale: rate?.stale ?? false,
      share: null,
      account_count: rows.filter((r) => (r.currencyCode ?? reporting).toUpperCase() === cur).length,
    }
    if (rate) {
      convertedAssets = convertedAssets.plus(convertAmount(assets, rate))
      convertedLiabilities = convertedLiabilities.plus(convertAmount(liabilities, rate))
      if (cur !== reporting) {
        if (rate.stale) stale = true
        if (!asOf || rate.rateDate < asOf) asOf = rate.rateDate
      }
    } else {
      excluded.push(cur)
    }
    byCurrency.push(entry)
  }
  // Share of converted assets held in each currency (of what could be converted).
  for (const e of byCurrency) {
    e.share = e.converted_assets != null && convertedAssets.gt(0) ? Number(new Decimal(e.converted_assets).div(convertedAssets).times(100).toDecimalPlaces(1)) : null
  }
  byCurrency.sort((a, b) => (b.converted_assets ?? 0) - (a.converted_assets ?? 0) || a.currency.localeCompare(b.currency))

  return {
    reporting_currency: reporting,
    net_worth: num2(convertedAssets.minus(convertedLiabilities)),
    assets: num2(convertedAssets),
    liabilities: num2(convertedLiabilities),
    complete: excluded.length === 0,
    excluded_currencies: excluded,
    as_of: asOf,
    stale,
    multi_currency: currencies.some((c) => c !== reporting),
    by_currency: byCurrency,
    accounts,
  }
}
