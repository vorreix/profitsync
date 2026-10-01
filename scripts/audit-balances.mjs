// Read-only audit: does every stored wealth balance agree with its ledger, and
// is every logical transfer whole? (MC-061)
//
// `wealth_accounts.current_balance` is STORED and moved step by step by every
// money path (src/lib/wealth-ledger.ts). Nothing ever checks it against the
// rows that are supposed to explain it, so a crash between two statements, a
// double refund or a purged Opening Balance drifts it silently. This script
// recomputes each account from its rows with the SAME rules the app applies:
//
//   expected = Σ (incoming +amount, outgoing −amount) over the account's rows
//              that are live, PLUS trashed SYSTEM rows — an Opening Balance /
//              Balance Adjustment defines the balance and is never reversed
//              through Trash (wealth-ledger.reversesOnTrash), so filing one
//              away leaves its effect in current_balance. A trashed ordinary
//              row was reversed; a purged row is gone either way.
//            + the account's opening_balance column when NO Opening Balance
//              row exists — purging a system row never touches current_balance,
//              and legacy accounts never got one. The column is written once
//              at create with the same signed value the row carries, so this
//              keeps a missing opening row from masquerading as drift
//              (has_opening = no still shows the row is gone). The row is
//              found by category OR description "Opening Balance" (either can
//              be relabelled). The fallback is a guess: --apply never posts on
//              an account that relies on it with a non-zero column.
//
// Everything is reported in the account's NATIVE currency (no conversion — a
// drift is a count of the account's own units).
//
// Transfer integrity (the header in `transfers` owns its legs AND fee rows):
//   • completed headers (live or trashed) that are not whole: not exactly two
//     kind='transfer' legs, or fee rows (kind<>'transfer', outgoing, any trash
//     state) not summing to source_fee_amount. Covers a header whose rows were
//     all purged, one left with only its fee row (purge widens by group_id and
//     fee rows carry none) and a live header missing a leg or its fee — any of
//     which set_transfer_trashed would restore/trash only partly
//   • header and leg trash state disagreeing (a live header with a trashed leg,
//     or the reverse) — only set_transfer_trashed may move them, together
//   • headerless kind='transfer' groups (legacy pairs 0071 left for audit).
//     Groups owned by the debt engine — any non-transfer leg or a loan/
//     receivable account — are headerless BY DESIGN and excluded, exactly as
//     the 0071 backfill excludes them.
// Currency: rows whose currency_code differs from their account's, and NULL
// currency_code on rows / accounts (must be zero before enforcing NOT NULL).
//
// DRY RUN BY DEFAULT. Every audit query runs in ONE read-only, repeatable-read
// transaction: Postgres refuses any write, and all sections see the same
// snapshot even while the app is posting. The report ends with the REPAIR PLAN:
// exactly what --apply would write, and every account it refuses and why.
//
// --apply <account id> / --apply-all --org <full org id> write that plan in ONE
// Serializable transaction (rules + statements: audit-balances-repair.mjs):
//   • a drifting account gets ONE system row for exactly its drift — "Ledger
//     reconciliation", category Adjustment, in the account's currency, dated
//     today, audited as operator:audit-balances — so stored == ledger. The
//     stored balance is never rewritten: the row EXPLAINS it. Accounts without
//     drift are never touched. Refused (and reported): a NULL currency, or any
//     transfer / currency finding on the account the tool cannot explain — the
//     drift may BE that finding, and a row would hide it. Also refused: an
//     account whose ledger assumes its opening_balance column (no opening row).
//   • a WHOLE completed header still live over rows that are ALL trashed gets
//     the rows' trash state (MC-116, the same statement as migration 0080);
//   • a completed header with NO rows, created before migration 0080 and linked
//     to no reversal, is deleted (its rows went with the pre-fix purge);
//   • header-less two-leg groups are reported only.
// A guard re-checks each planned drift and currency inside the transaction and
// aborts it whole if anything moved since the plan was printed.
//
// Usage (defaults to .env.local, same as db-migrate / make-admin):
//   npm run audit:balances
//   npm run audit:balances -- --org <organization id or its first 8+ chars>
//   npm run audit:balances -- --all             # every account, every row
//   npm run audit:balances -- --fail-on-drift   # exit 1 if any account drifts
//   npm run audit:balances -- --apply <account id>                 # repair one account
//   npm run audit:balances -- --apply-all --org <organization id>  # repair a workspace
// --apply exits 1 when anything in its scope was refused (it still writes the rest).
// Against PRODUCTION:
//   ENV_FILE=.env.production.local npm run audit:balances
import { readFileSync } from "node:fs"
import { config as loadDotenv } from "dotenv"
import { neon } from "@neondatabase/serverless"
import { LEDGER, RECONCILIATION_CATEGORY, RECONCILIATION_DESCRIPTION, applyStatements, repairPlan } from "./audit-balances-repair.mjs"

loadDotenv({ path: process.env.ENV_FILE || ".env.local" })

const USAGE =
  "Usage: node scripts/audit-balances.mjs [--org <id|prefix>] [--all] [--fail-on-drift] [--apply <account id> | --apply-all --org <organization id>]"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAMPLE = 50
// A full org id or the 8-char prefix the tables print (hex + dashes only, so it is
// safe inside LIKE).
const ORG_PREFIX = /^[0-9a-f][0-9a-f-]{7,35}$/i

const args = process.argv.slice(2)
let org = null
let all = false
let failOnDrift = false
let applyAccount = null
let applyAll = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--org" && ORG_PREFIX.test(args[i + 1] ?? "")) org = args[++i].toLowerCase()
  else if (args[i] === "--all") all = true
  else if (args[i] === "--fail-on-drift") failOnDrift = true
  else if (args[i] === "--apply" && UUID.test(args[i + 1] ?? "")) applyAccount = args[++i].toLowerCase()
  else if (args[i] === "--apply-all") applyAll = true
  else {
    console.error(USAGE)
    process.exit(2)
  }
}
// A write is scoped to exactly one account or one workspace — never a prefix
// that might match two, never the whole database.
if ((applyAll && (applyAccount || !UUID.test(org ?? ""))) || (applyAccount && org)) {
  console.error(`${USAGE}\n--apply-all needs the FULL --org id; --apply <account id> takes no --org.`)
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
if (applyAccount) {
  // The account's whole workspace is audited: a finding elsewhere in it (a
  // header-less group, a transfer) can be what blocks this account.
  const [acc] = await sql`select organization_id::text as org from wealth_accounts where id = ${applyAccount}`
  if (!acc) {
    console.error(`No wealth account ${applyAccount}.`)
    process.exit(2)
  }
  org = acc.org
}
// Row-less completed headers older than migration 0080 are pre-fix purge
// debris; anything newer is a new bug and only reported (audit-balances-repair.mjs).
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"))
const cutoffSeconds = (journal.entries.find((e) => e.tag.startsWith("0080_"))?.when ?? 0) / 1000

// `$1::text is null or … like` — one query shape for "whole database" and "one org".
const [accounts, broken, trashMismatch, headerless, mismatched, nullRows, nullAccounts] = await sql.transaction(
  [
    sql(
      `
      select wa.id, o.id as org, o.name as workspace, coalesce(nullif(wa.nickname, ''), wa.bank_name) as name, wa.type,
        wa.currency_code, coalesce(wa.currency_code, '?') as ccy, wa.archived_at is not null as archived,
        round(wa.current_balance, 2)::text as stored,
        round(l.expected, 2)::text as expected,
        round(wa.current_balance - l.expected, 2)::text as drift,
        (wa.current_balance - l.expected)::text as drift_exact,
        abs(wa.current_balance - l.expected) >= 0.005 as drifted,
        l.live_rows::int as live_rows, l.trashed_rows::int as trashed_rows,
        coalesce(l.has_opening, false) as has_opening, wa.opening_balance::text as opening_balance,
        -- Where a repair row goes: the workspace's own client, as every app
        -- system row (api/_lib/auth.ts ensureDefaultClient).
        (select c.id from clients c where c.organization_id = wa.organization_id and c.is_own and c.deleted_at is null
          order by c.created_at limit 1) as own_client
      from wealth_accounts wa
      join organizations o on o.id = wa.organization_id
      left join lateral (${LEDGER}) l on true
      where $1::text is null or wa.organization_id::text like $1 || '%'
      order by abs(wa.current_balance - l.expected) desc, o.name, 4`,
      [org],
    ),
    sql`
      select h.id, o.id as org, case when h.deleted_at is null then 'live' else 'trashed' end as header,
        count(t.id) filter (where t.kind = 'transfer')::int as legs, count(t.id)::int as rows, h.source_currency as ccy,
        round(h.source_fee_amount, 2)::text as fee,
        round(coalesce(sum(t.amount) filter (where t.kind <> 'transfer' and t.type = 'outgoing'), 0), 2)::text as fee_rows,
        h.transfer_date::text as date,
        array[h.source_account_id::text, h.destination_account_id::text] as accounts,
        h.created_at < (to_timestamp(${cutoffSeconds}::double precision) at time zone 'UTC') as legacy,
        (h.reverses_transfer_id is not null or exists (select 1 from transfers r where r.reverses_transfer_id = h.id)) as linked
      from transfers h join organizations o on o.id = h.organization_id
      left join transactions t on t.transfer_id = h.id
      where h.status = 'completed' and (${org}::text is null or h.organization_id::text like ${org} || '%')
      group by h.id, o.id
      having count(t.id) filter (where t.kind = 'transfer') <> 2
        or coalesce(sum(t.amount) filter (where t.kind <> 'transfer' and t.type = 'outgoing'), 0) <> h.source_fee_amount
      order by h.transfer_date`,
    sql`
      select h.id, o.id as org, case when h.deleted_at is null then 'live' else 'trashed' end as header,
        count(*)::int as disagreeing_rows, h.transfer_date::text as date,
        array[h.source_account_id::text, h.destination_account_id::text] as accounts,
        -- MC-116: a live completed header over rows that are ALL trashed.
        (h.deleted_at is null and h.status = 'completed'
          and not exists (select 1 from transactions a where a.transfer_id = h.id and a.deleted_at is null)) as all_trashed
      from transfers h join organizations o on o.id = h.organization_id
      join transactions t on t.transfer_id = h.id and (t.deleted_at is null) <> (h.deleted_at is null)
      where ${org}::text is null or h.organization_id::text like ${org} || '%'
      group by h.id, o.id
      order by h.transfer_date`,
    sql`
      select t.group_id as id, min(o.id::text) as org, count(*)::int as legs,
        count(*) filter (where t.deleted_at is null)::int as live_legs,
        string_agg(distinct coalesce(t.currency_code, '?'), ',') as ccy,
        round(max(t.amount), 2)::text as amount, min(t.date)::text as date,
        array_agg(distinct t.wealth_account_id::text) filter (where t.wealth_account_id is not null) as accounts
      from transactions t
      join clients c on c.id = t.client_id
      join organizations o on o.id = c.organization_id
      where t.kind = 'transfer' and t.group_id is not null
        and (${org}::text is null or c.organization_id::text like ${org} || '%')
        and not exists (select 1 from transfers h where h.group_id = t.group_id)
        and not exists (
          select 1 from transactions x
          left join wealth_accounts xw on xw.id = x.wealth_account_id
          where x.group_id = t.group_id and (x.kind <> 'transfer' or xw.type in ('loan', 'receivable'))
        )
      group by t.group_id
      order by min(t.date)`,
    sql`
      select t.id, o.id as org, wa.id as account, coalesce(nullif(wa.nickname, ''), wa.bank_name) as account_name,
        t.currency_code as row_ccy, wa.currency_code as account_ccy, round(t.amount, 2)::text as amount,
        t.deleted_at is not null as trashed, t.date::text as date
      from transactions t
      join wealth_accounts wa on wa.id = t.wealth_account_id
      join organizations o on o.id = wa.organization_id
      where t.currency_code <> wa.currency_code
        and (${org}::text is null or wa.organization_id::text like ${org} || '%')
      order by t.date`,
    sql`
      select o.id as org, (t.wealth_account_id is not null) as has_account, count(*)::int as rows,
        count(*) filter (where t.deleted_at is null)::int as live_rows
      from transactions t
      join clients c on c.id = t.client_id
      join organizations o on o.id = c.organization_id
      where t.currency_code is null and (${org}::text is null or c.organization_id::text like ${org} || '%')
      group by o.id, 2
      order by 3 desc`,
    sql`
      select wa.id, o.id as org, coalesce(nullif(wa.nickname, ''), wa.bank_name) as name, wa.type
      from wealth_accounts wa join organizations o on o.id = wa.organization_id
      where wa.currency_code is null and (${org}::text is null or wa.organization_id::text like ${org} || '%')`,
  ],
  { readOnly: true, isolationLevel: "RepeatableRead" },
)

// ── Output ───────────────────────────────────────────────────────────────────

const short = (v) => (typeof v === "string" && UUID.test(v) ? v.slice(0, 8) : v)
const cell = (v) => (v === true ? "yes" : v === false ? "no" : v == null ? "" : String(short(v)))
const NUMERIC = new Set(["stored", "expected", "drift", "fee", "fee_rows", "amount", "live_rows", "trashed_rows", "rows", "legs", "live_legs", "disagreeing_rows"])

function table(title, rows, cols) {
  console.log(`\n${title} — ${rows.length}`)
  if (!rows.length) return
  const shown = all ? rows : rows.slice(0, SAMPLE)
  const width = cols.map((c) => Math.min(32, Math.max(c.length, ...shown.map((r) => cell(r[c]).length))))
  const line = (vals) =>
    "  " + vals.map((v, i) => (NUMERIC.has(cols[i]) ? v.padStart(width[i]) : v.slice(0, width[i]).padEnd(width[i]))).join("  ")
  console.log(line(cols))
  console.log(line(width.map((w) => "-".repeat(w))))
  for (const r of shown) console.log(line(cols.map((c) => cell(r[c]))))
  if (shown.length < rows.length) console.log(`  … ${rows.length - shown.length} more (--all to list every row)`)
}

const drifted = accounts.filter((a) => a.drifted)
console.log(`[audit-balances] target: ${host}${org ? ` · org ${org}` : ""} · ${applyAccount || applyAll ? "APPLY (audit from a read-only snapshot)" : "dry run, read-only snapshot"}`)
console.log("[audit-balances] amounts are in each account's native currency; ids shortened to 8 chars")
table(
  all || org ? "Accounts (stored vs ledger)" : "Accounts whose stored balance differs from the ledger",
  all || org ? accounts : drifted,
  ["id", "org", "workspace", "name", "type", "ccy", "archived", "stored", "expected", "drift", "live_rows", "trashed_rows", "has_opening"],
)
table("Completed transfers that are not whole (2 legs + fee rows = fee)", broken, ["id", "org", "header", "legs", "ccy", "fee", "fee_rows", "date"])
table("Transfers whose header and legs disagree on Trash", trashMismatch, ["id", "org", "header", "disagreeing_rows", "date"])
table("Transfer groups without a header (debt-engine groups excluded)", headerless, ["id", "org", "legs", "live_legs", "ccy", "amount", "date"])
table("Rows whose currency differs from their account's", mismatched, ["id", "org", "account_name", "row_ccy", "account_ccy", "amount", "trashed", "date"])
table("Rows with NULL currency_code (per org)", nullRows, ["org", "has_account", "rows", "live_rows"])
table("Accounts with NULL currency_code", nullAccounts, ["id", "org", "name", "type"])

console.log(
  `\n[audit-balances] ${accounts.length} accounts, ${drifted.length} drifting · ` +
    `${broken.length + trashMismatch.length + headerless.length} transfer findings · ` +
    `${mismatched.length} currency-mismatched rows · ${nullRows.reduce((n, r) => n + r.rows, 0)} NULL-currency rows`,
)

// ── Repair plan (+ --apply) ──────────────────────────────────────────────────

const plan = repairPlan({ accounts, broken, trashMismatch, headerless, mismatched, only: applyAccount })
const today = new Date().toISOString().slice(0, 10)
const label = (a) => `${a.id}  ${a.workspace} / ${a.name} (${a.type}, ${a.ccy})`
console.log(`\nRepair plan${applyAccount ? ` for account ${applyAccount}` : ""} — what --apply writes`)
for (const p of plan.posts) {
  console.log(
    `  post    ${label(p.account)}: ${p.type} ${p.amount} ${p.account.currency_code} "${RECONCILIATION_DESCRIPTION}" ` +
      `(${RECONCILIATION_CATEGORY}, system row) dated ${today} — stored ${p.account.stored} = ledger ${p.account.expected} + drift ${p.account.drift}`,
  )
}
for (const id of plan.markTrashed) console.log(`  trash   transfer header ${id} — every row it owns is already in Trash (MC-116)`)
for (const id of plan.deleteHeaders) console.log(`  delete  transfer header ${id} — completed, no rows left, older than migration 0080`)
for (const r of plan.refused) console.log(`  REFUSED ${label(r.account)}: ${r.reasons.join("; ")}`)
const writes = plan.posts.length + plan.markTrashed.length + plan.deleteHeaders.length
if (!writes && !plan.refused.length) console.log("  nothing to repair")

// exitCode, not exit(): stdout to a pipe is async on macOS, and exit() would
// drop the buffered tail of the report (its summary line included).
if (!applyAccount && !applyAll) {
  console.log(`\nDRY RUN — nothing written.${writes ? " Re-run with --apply <account id> or --apply-all --org <organization id>." : ""}`)
  process.exitCode = failOnDrift && drifted.length ? 1 : 0
} else if (!writes) {
  console.log("\nNothing to write.")
  process.exitCode = plan.refused.length ? 1 : 0
} else {
  try {
    const results = await sql.transaction(
      applyStatements(plan, cutoffSeconds).map(([text, params]) => sql(text, params)),
      { isolationLevel: "Serializable" },
    )
    const posted = plan.posts.length ? results[1][0] : { posted: 0, logged: 0 }
    const rest = results.slice(plan.posts.length ? 2 : 0)
    const trashed = plan.markTrashed.length ? rest.shift().length : 0
    const deleted = plan.deleteHeaders.length ? rest.shift().length : 0
    console.log(
      `\nAPPLIED: ${posted.posted} reconciliation row(s) posted (${posted.logged} audit entries by operator:audit-balances), ` +
        `${trashed} header(s) moved to Trash, ${deleted} row-less header(s) deleted. Re-run the audit to confirm.`,
    )
    process.exitCode = plan.refused.length ? 1 : 0
  } catch (err) {
    console.error(
      /division by zero/i.test(String(err?.message))
        ? "\nAborted: a planned account's balance, ledger or currency changed since the plan. Nothing was written — re-run."
        : `\nAborted, nothing was written: ${err?.message ?? err}`,
    )
    process.exitCode = 1
  }
}
