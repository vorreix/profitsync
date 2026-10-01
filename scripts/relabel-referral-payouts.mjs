// Relabel legacy referral payouts to the currency they actually paid. (MC-005)
//
// Why: before per-currency referral balances, every payout_requests row was
// labelled with the PROGRAMME currency (referral_settings.reward_currency,
// default USD), while a percent reward is snapshotted in the PAYMENT's currency
// (an Indian org always pays INR). computeStats (api/_lib/referral.ts) now
// subtracts a payout only from the balance in ITS currency and counts paid_out
// rewards as earned — so a legacy "USD 249.75" payout that really paid INR
// rewards lands on an empty USD balance, the INR rewards read "Available
// ₹249.75" again, and the same money can be requested and paid a SECOND time.
//
// RUN THIS BEFORE DEPLOYING per-currency referral balances (dry run, read the
// review list, then --apply). It is idempotent: re-run it afterwards to confirm
// nothing is left to relabel.
//
// What --apply writes: for every referrer whose earned rewards (paid/paid_out)
// are all in ONE known currency C, payout_requests.currency = C on each of
// their payouts labelled otherwise. A label only — never an amount. Every one
// of their payouts paid C money, because C is the only money they ever had.
//
// What it never writes, only lists for a human (with per-currency figures under
// the new math): any OTHER referrer that has payouts — rewards in two or more
// currencies (a legacy payout then summed amounts of different currencies, so
// no single label is right: split or relabel it by hand), payouts with no
// earned reward, or a reward currency the app doesn't know. Reconcile those
// before the deploy too: an available balance there may already have been paid.
//
// Usage (defaults to .env.local, same as db-migrate / relabel-org-currency):
//   node scripts/relabel-referral-payouts.mjs            # dry run
//   node scripts/relabel-referral-payouts.mjs --apply
// Against PRODUCTION:
//   ENV_FILE=.env.production.local node scripts/relabel-referral-payouts.mjs [--apply]
import { readFileSync } from "node:fs"
import { config as loadDotenv } from "dotenv"
import { neon } from "@neondatabase/serverless"

loadDotenv({ path: process.env.ENV_FILE || ".env.local" })

const args = process.argv.slice(2)
const apply = args.includes("--apply")
if (args.some((a) => a !== "--apply")) {
  console.error("Usage: node scripts/relabel-referral-payouts.mjs [--apply]")
  process.exit(2)
}
// The app's own list (src/lib/currencies.ts CURRENCY_LIST), read as text so this
// stays a plain .mjs with no TS loader: every entry there is `code: "XXX"`.
const KNOWN = [
  ...new Set(
    [...readFileSync(new URL("../src/lib/currencies.ts", import.meta.url), "utf8").matchAll(/\bcode: "([A-Z]{3})"/g)].map((m) => m[1]),
  ),
]

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set (point ENV_FILE at the right env file).")
  process.exit(2)
}
let host = "(unparseable DATABASE_URL)"
try {
  host = new URL(url).hostname
} catch {
  /* leave the placeholder */
}
const sql = neon(url)

// Referrers whose earned money is ONE known currency, and the payouts of theirs
// labelled otherwise ($1 = known codes). Shared by the dry run and --apply, so
// what is printed is exactly what is written.
const SINGLE = `
  single as (
    select referrer_user_id as user_id, min(upper(btrim(reward_currency))) as ccy
    from referrals
    where status in ('paid', 'paid_out') and reward_amount > 0
    group by 1
    having count(distinct upper(btrim(reward_currency))) = 1
       and bool_and(upper(btrim(reward_currency)) = any($1::text[]))
  ),
  plan as (
    select p.id, p.user_id, p.status, p.amount, p.currency as from_ccy, s.ccy as to_ccy, p.created_at
    from payout_requests p join single s on s.user_id = p.user_id
    where p.currency is distinct from s.ccy
  )`

const [plan, review] = await sql.transaction(
  [
    sql(`with ${SINGLE} select * from plan order by user_id, created_at`, [KNOWN]),
    // Everyone else with a payout, per currency, under the math computeStats runs.
    sql(
      `with ${SINGLE},
        review as (select distinct user_id from payout_requests where user_id not in (select user_id from single)),
        x as (
          select referrer_user_id as user_id, upper(btrim(reward_currency)) as ccy,
                 reward_amount as earned,
                 case when qualifying_at <= now() then reward_amount else 0 end as eligible,
                 case when status = 'paid_out' then reward_amount else 0 end as paid_out,
                 0::numeric as claimed
          from referrals where status in ('paid', 'paid_out') and reward_amount > 0
          union all
          select user_id, upper(btrim(currency)), 0, 0, 0,
                 case when status in ('requested', 'approved', 'paid') then amount else 0 end
          from payout_requests)
      select r.user_id, up.email, x.ccy,
             sum(x.earned) as earned, sum(x.eligible) as eligible, sum(x.paid_out) as paid_out, sum(x.claimed) as claimed
      from review r join x on x.user_id = r.user_id left join user_profiles up on up.id = r.user_id
      group by 1, 2, 3 order by 1, 3`,
      [KNOWN],
    ),
  ],
  { readOnly: true, isolationLevel: "RepeatableRead" },
)

const n = (v) => Number(v ?? 0).toFixed(2).padStart(12)
console.log(`[relabel-referral-payouts] target: ${host} · ${apply ? "APPLY" : "dry run"}`)

console.log(`\nSingle-currency referrers — payouts to relabel (label only): ${plan.length}`)
for (const p of plan) {
  console.log(`  ${p.id}  user ${p.user_id}  ${String(p.status).padEnd(9)} ${n(p.amount)}  ${p.from_ccy} → ${p.to_ccy}`)
}

const users = [...new Set(review.map((r) => r.user_id))]
console.log(`\nNeeds a human (never written by this script): ${users.length} referrer(s)`)
for (const u of users) {
  const rows = review.filter((r) => r.user_id === u)
  console.log(`  user ${u}${rows[0].email ? ` <${rows[0].email}>` : ""}`)
  console.log(`    ccy        earned     eligible     paid_out      claimed    available`)
  for (const r of rows) {
    const available = Math.max(0, Number(r.eligible) - Number(r.claimed))
    console.log(`    ${String(r.ccy).padEnd(5)}${n(r.earned)} ${n(r.eligible)} ${n(r.paid_out)} ${n(r.claimed)} ${n(available)}`)
  }
}
if (users.length) {
  console.log(
    "  → A legacy payout here was labelled with the programme currency whatever it paid. Relabel or split it by hand\n" +
      "    so each currency's claims match what was really paid in it, BEFORE the per-currency balances deploy.",
  )
}

if (!plan.length) {
  console.log("\nNothing to relabel.")
  process.exit(0)
}
if (!apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to relabel.")
  process.exit(0)
}

// ONE statement: the target set is recomputed inside it, so a reward credited in
// another currency since the census turns that referrer mixed and leaves them out.
let written
try {
  written = await sql(
    `with ${SINGLE},
      upd as (update payout_requests p set currency = plan.to_ccy, updated_at = now()
              from plan where p.id = plan.id returning p.id)
    select plan.* from plan join upd using (id) order by user_id, created_at`,
    [KNOWN],
  )
} catch (err) {
  console.error("\nAborted, nothing was written:", err?.message ?? err)
  process.exit(1)
}
console.log(`\nRelabelled ${written.length} payout(s):`)
for (const p of written) console.log(`  ${p.id}  ${p.from_ccy} → ${p.to_ccy}`)
