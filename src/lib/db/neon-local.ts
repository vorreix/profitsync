// LOCAL DEVELOPMENT ONLY — teaches the Neon serverless driver about a local
// Neon-protocol proxy (see docs/budget-v2/LOCAL_DB.md).
//
// Why this exists: the app talks to Postgres exclusively through
// `@neondatabase/serverless` + `drizzle-orm/neon-http`. That driver derives its
// HTTP endpoint from the connection string's HOSTNAME and ignores the port, so a
// URL like `postgres://…@db.localtest.me:4444/main` is POSTed to
// `https://db.localtest.me/sql` (port 443) instead of `:4444`. Locally that hits
// whatever else is on 443 and fails with a confusing 404.
//
// Why not swap drivers locally: `node-postgres` supports interactive
// transactions, `neon-http` does not — it only offers `db.batch()`. Budget v2's
// audit invariants are built on that constraint, so running local development on
// a different driver would hide a real production limitation. Keeping neon-http
// and only correcting the endpoint preserves exact parity.
//
// Production is untouched: the override applies only when the host is a loopback
// alias AND an explicit port is present.
import { neonConfig } from "@neondatabase/serverless"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db.localtest.me"])

/**
 * Point the driver at `https://<host>:<port>/sql` when DATABASE_URL is a local
 * Neon proxy. Idempotent and safe to call at module load; a missing, placeholder
 * or non-local URL leaves the driver's defaults (and therefore production)
 * completely alone.
 */
export function configureLocalNeonEndpoint(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    return false // placeholder value (e.g. the DB-free unit gate) — nothing to do
  }
  if (!url.port || !LOCAL_HOSTS.has(url.hostname)) return false
  const port = url.port
  neonConfig.fetchEndpoint = (host) => `https://${host}:${port}/sql`
  return true
}
