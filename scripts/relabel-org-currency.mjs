// Relabel ONE workspace's money to the currency it was always in. (MC-032)
//
// When: a workspace was created in the wrong currency (the MC-001 onboarding
// bug, or a user's slip) — its accounts and rows say USD, but every amount was
// typed in INR. Nothing in the app repairs that: changing the reporting
// currency makes it WORSE (/wealth then converts "USD 50,000" to ≈ ₹44,00,000),
// and an account's currency is locked once it has a row (account_currency_locked).
//
// What: rewrites the currency LABEL — never an amount, never through a rate — on
//   wealth_accounts.currency_code
//   transactions.currency_code        (the org's rows, scoped through clients)
//   recurring_rules.currency_code
//   spending_budgets.currency_code
//   budgets.currency_code + budget_history.currency_code   (v1 per-client caps, mig 0077)
//   quotations.currency_code                                (mig 0077)
//   transfers.source_currency + destination_currency
//   debt_details.currency
//   organizations.currency + reporting_currency (together, as
//                                    api/_lib/org-currency.ts setOrgCurrency does)
// and appends one audit_logs entry (entity 'organization', actor
// 'operator:relabel-org-currency') with from/to and the rows changed per table.
//
// Refuses unless every one of those rows is in ONE currency today. A NULL label
// counts as what the app reads it as — the workspace's reporting currency
// (reporting_amount(), transaction-currency.ts) — so EUR rows beside NULL rows
// shown as USD are two currencies, not one. A workspace already holding two
// currencies has real cross-currency history — a USD loan in an INR workspace —
// and relabelling it would corrupt that; it needs a human, not this script.
//
// Safe by default: a DRY RUN that prints the census and what would change.
// --apply runs everything in ONE Serializable transaction: a guard statement
// first re-checks the currency set and aborts the whole batch (nothing written)
// if a row in another currency appeared since the census, then a single
// statement relabels every table and writes the audit entry.
//
// Afterwards: open tabs revalidate on their own (money reads are short-lived);
// ask the workspace's users to reload to see it at once.
//
// Usage (defaults to .env.local, same as db-migrate / audit-balances):
//   node scripts/relabel-org-currency.mjs --org <organization uuid> --to INR           # dry run
//   node scripts/relabel-org-currency.mjs --org <organization uuid> --to INR --apply
// Against PRODUCTION:
//   ENV_FILE=.env.production.local node scripts/relabel-org-currency.mjs --org … --to … [--apply]
import { readFileSync } from "node:fs"
import { config as loadDotenv } from "dotenv"
import { neon } from "@neondatabase/serverless"

loadDotenv({ path: process.env.ENV_FILE || ".env.local" })

const USAGE = "Usage: node scripts/relabel-org-currency.mjs --org <organization uuid> --to <currency code> [--apply]"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTOR = "operator:relabel-org-currency"
// The app's own list (src/lib/currencies.ts CURRENCY_LIST), read as text so this
// stays a plain .mjs with no TS loader: every entry there is `code: "XXX"`.
const KNOWN = new Set(
  [...readFileSync(new URL("../src/lib/currencies.ts", import.meta.url), "utf8").matchAll(/\bcode: "([A-Z]{3})"/g)].map((m) => m[1]),
)

const args = process.argv.slice(2)
let orgId = null
let to = null
let apply = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--org" && UUID.test(args[i + 1] ?? "")) orgId = args[++i].toLowerCase()
  else if (args[i] === "--to" && args[i + 1]) to = args[++i].trim().toUpperCase()
  else if (args[i] === "--apply") apply = true
  else {
    console.error(USAGE)
    process.exit(2)
  }
}
if (!orgId || !to) {
  console.error(USAGE)
  process.exit(2)
}
if (!KNOWN.has(to)) {
  console.error(`Unknown currency "${to}" — not in src/lib/currencies.ts.`)
  process.exit(2)
}

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

// Every currency label this script owns, one row per labelled thing ($1 = org).
// Shared by the census and the in-transaction guard so both see the same set.
const SCOPED = `
  select 'wealth_accounts' as tbl, currency_code as ccy from wealth_accounts where organization_id = $1
  union all select 'transactions', t.currency_code from transactions t join clients c on c.id = t.client_id where c.organization_id = $1
  union all select 'recurring_rules', currency_code from recurring_rules where organization_id = $1
  union all select 'spending_budgets', currency_code from spending_budgets where organization_id = $1
  union all select 'budgets', currency_code from budgets where organization_id = $1
  union all select 'budget_history', currency_code from budget_history where organization_id = $1
  union all select 'quotations', currency_code from quotations where organization_id = $1
  union all select 'transfers.source', source_currency from transfers where organization_id = $1
  union all select 'transfers.destination', destination_currency from transfers where organization_id = $1
  union all select 'debt_details', currency from debt_details where organization_id = $1`

const [[org], census] = await sql.transaction(
  [
    sql(`select id, name, currency, reporting_currency from organizations where id = $1`, [orgId]),
    sql(`select tbl, upper(ccy) as ccy, count(*)::int as rows from (${SCOPED}) s group by 1, 2 order by 1, 2`, [orgId]),
  ],
  { readOnly: true, isolationLevel: "RepeatableRead" },
)
if (!org) {
  console.error(`No organization ${orgId} on ${host}.`)
  process.exit(2)
}

const reporting = (org.reporting_currency ?? org.currency).toUpperCase()
console.log(`[relabel-org-currency] target: ${host} · ${apply ? "APPLY" : "dry run"}`)
console.log(`  workspace: ${org.name} (${org.id})`)
console.log(`  reporting currency: ${reporting} · legacy column: ${org.currency}`)
console.log(`\nCurrency labels today`)
for (const r of census) console.log(`  ${r.tbl.padEnd(24)} ${(r.ccy ?? `NULL (read as ${reporting})`).padEnd(5)} ${String(r.rows).padStart(8)}`)
if (!census.length) console.log("  (no money rows)")

// A NULL label is read as the reporting currency everywhere in the app, so it
// counts as that here — relabelling it changes what it means just the same.
const labels = [...new Set(census.map((r) => r.ccy ?? reporting))]
if (labels.length > 1) {
  console.error(
    `\nRefused: this workspace holds ${labels.join(", ")}. A relabel is only safe when every row shares ONE ` +
      `currency — anything else is real cross-currency history. Nothing was written.`,
  )
  process.exit(1)
}
const from = labels[0] ?? null
const pending = census.filter((r) => r.ccy !== to)
const orgPending = org.currency !== to || org.reporting_currency !== to
if (!pending.length && !orgPending) {
  console.log(`\nNothing to relabel: everything is already ${to}.`)
  process.exit(0)
}

console.log(`\nWould relabel ${from ?? "(unlabelled)"} → ${to} — labels only, no amount changes`)
for (const r of pending) console.log(`  ${r.tbl.padEnd(24)} ${String(r.rows).padStart(8)} row(s)`)
if (orgPending) console.log(`  organizations            currency ${org.currency}, reporting ${org.reporting_currency ?? "NULL"} → ${to}`)

if (!apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to relabel.")
  process.exit(0)
}

let result
try {
  const [, rows] = await sql.transaction(
    [
      // Guard: any row whose currency (NULL read as the reporting currency, as
      // the census did) is not `from` divides by zero, which aborts the whole
      // transaction — so a row in a new currency that landed after the census
      // can never be relabelled into the wrong one.
      sql(
        `select 1 / (case when count(*) = 0 then 1 else 0 end) as ok
         from (${SCOPED}) s
         where upper(coalesce(s.ccy, (select coalesce(reporting_currency, currency) from organizations where id = $1))) is distinct from $2`,
        [orgId, from],
      ),
      // ONE statement: every table + the org + the audit entry with the exact
      // row counts ($1 org, $2 target, $3 from, $4 previous reporting currency).
      sql(
        `with
          wa as (update wealth_accounts set currency_code = $2
                 where organization_id = $1 and currency_code is distinct from $2 returning 1),
          tx as (update transactions t set currency_code = $2 from clients c
                 where c.id = t.client_id and c.organization_id = $1 and t.currency_code is distinct from $2 returning 1),
          rr as (update recurring_rules set currency_code = $2
                 where organization_id = $1 and currency_code is distinct from $2 returning 1),
          sb as (update spending_budgets set currency_code = $2
                 where organization_id = $1 and currency_code is distinct from $2 returning 1),
          tf as (update transfers set source_currency = $2, destination_currency = $2
                 where organization_id = $1 and (source_currency <> $2 or destination_currency <> $2) returning 1),
          dd as (update debt_details set currency = $2
                 where organization_id = $1 and currency is distinct from $2 returning 1),
          bu as (update budgets set currency_code = $2
                 where organization_id = $1 and currency_code is distinct from $2 returning 1),
          bh as (update budget_history set currency_code = $2
                 where organization_id = $1 and currency_code is distinct from $2 returning 1),
          qu as (update quotations set currency_code = $2
                 where organization_id = $1 and currency_code is distinct from $2 returning 1),
          og as (update organizations set currency = $2, reporting_currency = $2, updated_at = now()
                 where id = $1 returning 1),
          counts as (select
            (select count(*) from wa)::int as wealth_accounts,
            (select count(*) from tx)::int as transactions,
            (select count(*) from rr)::int as recurring_rules,
            (select count(*) from sb)::int as spending_budgets,
            (select count(*) from tf)::int as transfers,
            (select count(*) from dd)::int as debt_details,
            (select count(*) from bu)::int as budgets,
            (select count(*) from bh)::int as budget_history,
            (select count(*) from qu)::int as quotations,
            (select count(*) from og)::int as organizations),
          log as (insert into audit_logs (organization_id, entity_type, entity_id, action, actor_user_id, changes)
                  select $1, 'organization', $1, 'update', '${ACTOR}',
                         jsonb_build_object(
                           'reporting_currency', jsonb_build_object('from', $4::text, 'to', $2::text),
                           'relabelled', jsonb_build_object('from', $3::text, 'to', $2::text, 'rows', to_jsonb(counts)))
                  from counts returning 1)
        select counts.*, (select count(*) from log)::int as audit_entries from counts`,
        [orgId, to, from, reporting],
      ),
    ],
    { isolationLevel: "Serializable" },
  )
  result = rows[0]
} catch (err) {
  if (/division by zero/i.test(String(err?.message))) {
    console.error("\nAborted: a row in another currency appeared since the census. Nothing was written — re-run the dry run.")
  } else {
    console.error("\nAborted, nothing was written:", err?.message ?? err)
  }
  process.exit(1)
}

console.log(`\nRelabelled ${from ?? "(unlabelled)"} → ${to} (audit entry by ${ACTOR})`)
for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(24)} ${String(v).padStart(8)}`)
