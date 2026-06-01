import { neon, type NeonQueryFunction } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema.js"
import { withDbRetry } from "./retry.js"

const rawSql = neon(process.env.DATABASE_URL!)

// Drizzle's neon-http session runs every query by calling the client as
// `client(sql, params, opts)` (it uses `client.query ?? client`) and runs
// batches via `client.transaction(...)`. We wrap both so transient,
// Neon-flagged-retryable connectivity failures (control-plane resume,
// connection-permit exhaustion) are retried with backoff instead of bubbling
// up as 500s. Genuine SQL errors (which carry a Postgres SQLSTATE) are not
// retried — see ./retry.ts. The casts adapt our plain async wrapper to Neon's
// overloaded callable type; runtime behaviour is unchanged for callers.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>
const sql = ((...args: unknown[]) =>
  withDbRetry(() => (rawSql as unknown as AnyAsyncFn)(...args))) as unknown as NeonQueryFunction<false, false>
sql.transaction = ((...args: unknown[]) =>
  withDbRetry(() => (rawSql.transaction as unknown as AnyAsyncFn)(...args))) as unknown as typeof rawSql.transaction

export const db = drizzle(sql, { schema })

export function serialize<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/([A-Z])/g, "_$1").toLowerCase(),
      v,
    ])
  )
}
