// Applies pending Drizzle migrations against DATABASE_URL.
// Runs as part of the Vercel build (see "vercel-build" in package.json) so the
// production database schema is updated automatically on every deploy.
//
// - Locally, DATABASE_URL comes from `.env.local` (the Neon instance), or from
//   ENV_FILE when set (same convention as audit-balances.mjs) — loaded without
//   `override`, so an already-exported DATABASE_URL still wins and on Vercel
//   (no env file) the platform env is used untouched.
// - No-ops (exit 0) when DATABASE_URL is absent, so builds in environments
//   without a database configured (e.g. some preview contexts) don't fail.
// - Uses the Neon HTTP driver; idempotent — already-applied migrations are
//   skipped via the drizzle.__drizzle_migrations bookkeeping table.
// - Then checks a schema sentinel and exits 1 when it is missing (MC-115).
import { config as loadDotenv } from "dotenv"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { migrate } from "drizzle-orm/neon-http/migrator"

loadDotenv({ path: process.env.ENV_FILE || ".env.local" })

const url = process.env.DATABASE_URL
if (!url) {
  console.log("[db-migrate] DATABASE_URL not set — skipping migrations")
  process.exit(0)
}

const sql = neon(url)
const db = drizzle(sql)
// Name the target before touching it — a migration against the wrong database
// is the one mistake that is cheaper to prevent than to repair.
let host = "(unparseable DATABASE_URL)"
try {
  host = new URL(url).hostname
} catch {
  /* leave the placeholder */
}
console.log(`[db-migrate] target: ${host}`)
console.log("[db-migrate] applying migrations from ./drizzle …")
await migrate(db, { migrationsFolder: "drizzle" })

// "Up to date" only means no journal entry sorts above this database's
// watermark — an entry stamped below it is skipped silently (MC-115: dev's
// 0075 shipped first would hide 0069-0074). So prove the multi-currency schema
// is actually there, and fail the build when it is not.
const [present] = await sql`
  select
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'currency_code') as "transactions.currency_code",
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wealth_accounts' and column_name = 'currency_code') as "wealth_accounts.currency_code",
    to_regclass('public.transfers') is not null as "transfers table",
    to_regprocedure('public.reporting_amount(numeric,text,date,text)') is not null as "reporting_amount(numeric,text,date,text)",
    to_regprocedure('public.fx_rate_on(text,text,date)') is not null as "fx_rate_on(text,text,date)",
    exists (select 1 from pg_constraint where conname = 'transactions_account_currency_fk') as "transactions_account_currency_fk"`
const missing = Object.entries(present).filter(([, ok]) => !ok).map(([name]) => name)
if (missing.length) {
  console.error(`[db-migrate] SCHEMA SENTINEL FAILED on ${host} — missing: ${missing.join(", ")}`)
  console.error("[db-migrate] a migration was skipped by the watermark (max created_at in drizzle.__drizzle_migrations).")
  console.error("[db-migrate] See .claude/skills/migrations/SKILL.md and docs/multi-currency/RELEASE.md.")
  process.exit(1)
}
console.log("[db-migrate] database schema is up to date (multi-currency sentinel ok)")
