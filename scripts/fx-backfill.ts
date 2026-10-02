// Backfill one currency pair's daily FX history further back than the request
// path goes (MC-166). Report requests fill at most six years back; the ECB
// reference series starts 1999-01-04, the daily archive (non-ECB currencies)
// 2024-03-02. Idempotent: what is already settled is not refetched.
//
// Run:  npx tsx scripts/fx-backfill.ts EUR USD 2019-01-01
//       (writes fx_rate_snapshots through DATABASE_URL from .env.local)
import { config } from "dotenv"
config({ path: ".env.local" })

const [base, quote, from] = process.argv.slice(2)
if (!base || !quote || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? "")) {
  console.error("usage: npx tsx scripts/fx-backfill.ts <BASE> <QUOTE> <YYYY-MM-DD>")
  process.exit(1)
}

// Imported after dotenv: the db client reads DATABASE_URL when it loads.
const { ensureHistoricalRates } = await import("../api/_lib/fx-rates.js")
// The daily archive is read a bounded number of days per call; keep calling
// while calls still fill days.
let result: { covered: boolean; written?: number } = { covered: false, written: 1 }
while (!result.covered && (result.written ?? 0) > 0) result = await ensureHistoricalRates(base, quote, from, { floor: from })
const covered = result.covered
console.log(covered ? `✓ ${base}/${quote} has a rate for every day since ${from}` : `✗ ${base}/${quote}: some days since ${from} have no rate from any provider — rows on them stay excluded`)
