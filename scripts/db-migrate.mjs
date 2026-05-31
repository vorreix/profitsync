// Applies pending Drizzle migrations against DATABASE_URL.
// Runs as part of the Vercel build (see "vercel-build" in package.json) so the
// production database schema is updated automatically on every deploy.
//
// - No-ops (exit 0) when DATABASE_URL is absent, so builds in environments
//   without a database configured (e.g. some preview contexts) don't fail.
// - Uses the Neon HTTP driver; idempotent — already-applied migrations are
//   skipped via the drizzle.__drizzle_migrations bookkeeping table.
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { migrate } from "drizzle-orm/neon-http/migrator"

const url = process.env.DATABASE_URL
if (!url) {
  console.log("[db-migrate] DATABASE_URL not set — skipping migrations")
  process.exit(0)
}

const db = drizzle(neon(url))
console.log("[db-migrate] applying migrations from ./drizzle …")
await migrate(db, { migrationsFolder: "drizzle" })
console.log("[db-migrate] database schema is up to date")
