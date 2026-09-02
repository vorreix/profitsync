// Applies pending Drizzle migrations against DATABASE_URL.
// Runs as part of the Vercel build (see "vercel-build" in package.json) so the
// production database schema is updated automatically on every deploy.
//
// - No-ops (exit 0) when DATABASE_URL is absent, so builds in environments
//   without a database configured (e.g. some preview contexts) don't fail.
// - Uses the Neon HTTP driver; idempotent — already-applied migrations are
//   skipped via the drizzle.__drizzle_migrations bookkeeping table.
import { neon, neonConfig } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { migrate } from "drizzle-orm/neon-http/migrator"

const url = process.env.DATABASE_URL
if (!url) {
  console.log("[db-migrate] DATABASE_URL not set — skipping migrations")
  process.exit(0)
}

// LOCAL DEVELOPMENT ONLY — mirrors src/lib/db/neon-local.ts (duplicated because
// this script is plain .mjs and cannot import the TypeScript module). The Neon
// driver ignores the connection-string port when building its HTTP endpoint, so
// a local proxy on a non-443 port is unreachable without this. Guarded to
// loopback hosts with an explicit port, so production builds are unaffected.
{
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db.localtest.me"])
  try {
    const parsed = new URL(url)
    if (parsed.port && LOCAL_HOSTS.has(parsed.hostname)) {
      const port = parsed.port
      neonConfig.fetchEndpoint = (host) => `https://${host}:${port}/sql`
      console.log(`[db-migrate] local Neon proxy detected — using :${port}`)
    }
  } catch {
    /* not a parseable URL — leave driver defaults alone */
  }
}

const db = drizzle(neon(url))
console.log("[db-migrate] applying migrations from ./drizzle …")
await migrate(db, { migrationsFolder: "drizzle" })
console.log("[db-migrate] database schema is up to date")
