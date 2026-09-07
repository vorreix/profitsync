// Applies pending Drizzle migrations against DATABASE_URL.
// Runs as part of the Vercel build (see "vercel-build" in package.json) so the
// production database schema is updated automatically on every deploy.
//
// - Locally, DATABASE_URL comes from `.env.local` (the Neon instance) — loaded
//   here without `override`, so an already-exported DATABASE_URL still wins and
//   on Vercel (no `.env.local` file) the platform env is used untouched.
// - No-ops (exit 0) when DATABASE_URL is absent, so builds in environments
//   without a database configured (e.g. some preview contexts) don't fail.
// - Uses the Neon HTTP driver; idempotent — already-applied migrations are
//   skipped via the drizzle.__drizzle_migrations bookkeeping table.
import { config as loadDotenv } from "dotenv"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { migrate } from "drizzle-orm/neon-http/migrator"

loadDotenv({ path: ".env.local" })

const url = process.env.DATABASE_URL
if (!url) {
  console.log("[db-migrate] DATABASE_URL not set — skipping migrations")
  process.exit(0)
}

const db = drizzle(neon(url))
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
console.log("[db-migrate] database schema is up to date")
