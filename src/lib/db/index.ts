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

// ─────────────────────────────────────────────────────────────────────────────
// Atomic multi-statement writes
// ─────────────────────────────────────────────────────────────────────────────
//
// `db.batch()` CANNOT be used on the retry-wrapped client above, and the failure
// is not obvious:
//
//   Drizzle's neon-http session builds each batch element by calling
//   `client.query ?? client` and hands the ARRAY to `client.transaction(...)`.
//   Neon's `transaction()` then reads `element.parameterizedQuery` and
//   `element.opts` SYNCHRONOUSLY — it never awaits the elements — and rejects
//   anything whose `Symbol.toStringTag` is not `NeonQueryPromise`.
//
//   The raw neon callable returns exactly such a lazy NeonQueryPromise. Our
//   retry wrapper returns `withDbRetry(...)`, i.e. a PLAIN promise that has
//   already started executing and carries no query descriptor. So every
//   `db.batch()` throws "transaction() expects an array of queries" at runtime —
//   a failure no type check or unit test can see, because it depends on which
//   client object drizzle happened to be given.
//
// So batches run on a second drizzle instance bound to the RAW callable, with
// the retry applied around the whole batch instead of around each element
// (which is the right granularity anyway: a batch is one HTTP round trip, so it
// either all arrives or none of it does).
//
// Query BUILDERS are interchangeable between the two instances: drizzle's
// `batch()` only calls `_prepare().getQuery()` on each one to get SQL text and
// params, then builds the elements with its OWN session's client. So call sites
// keep composing with `db.update(...)` / `db.insert(...)` as usual.
const rawDb = drizzle(rawSql, { schema })

/**
 * Run several statements atomically in ONE round trip.
 *
 * This is the only atomicity primitive the neon-http driver has — it has no
 * interactive transactions — so anything that must not be observed half-applied
 * (both legs of a reallocation, a period close plus its snapshot) belongs here.
 */
export const dbBatch: typeof rawDb.batch = ((queries: never) =>
  withDbRetry(() => rawDb.batch(queries))) as typeof rawDb.batch

export function serialize<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/([A-Z])/g, "_$1").toLowerCase(),
      v,
    ])
  )
}
