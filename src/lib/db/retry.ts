// Transient-error retry for the Neon HTTP driver — ONLY for failures that
// provably happened before the statement reached Postgres (MC-060).
//
// A replay is safe only when the first attempt never ran. Money statements are
// not idempotent (`current_balance = current_balance + x`), and a network error
// AFTER the request was sent says nothing about whether the server committed:
// replaying it applied the change twice. So:
//
//   retried — the request never reached Postgres:
//     • Neon's proxy refused before connecting to compute: connection-permit
//       exhaustion, "control plane request failed" while a suspended compute
//       resumes. The proxy flags these `"neon:retryable": true` (its CouldRetry
//       is the connect phase only); the driver embeds that body in `message`.
//     • fetch never opened a connection: DNS (getaddrinfo), TCP connect
//       (ECONNREFUSED, connect ETIMEDOUT), undici's connect timeout, or a TLS
//       handshake that never completed.
//   never retried — it may have run:
//     • anything carrying a Postgres SQLSTATE (it ran and failed),
//     • a socket reset / "other side closed" / hang-up after connecting, a 5xx
//       gateway error, a body timeout. The driver words EVERY fetch failure as
//       "Error connecting to database: fetch failed", so the message proves
//       nothing — only the cause chain (sourceError → cause → AggregateError
//       .errors) says where it failed.
//
// Consequence for batches with pre-generated ids (createTransfer's transfer +
// group ids, a debt payment's ids, debt and recurring-rule creation): a replay
// can no longer meet the rows of its own first attempt, so a 23505 on such an
// id is always a real conflict and is surfaced as one — nothing needs to treat
// it as success. An
// ambiguous failure surfaces as an error even if it committed; only a
// client-supplied idempotency key could tell those apart.
// ponytail: ambiguous failures are not retried even for read-only SELECTs —
// a SELECT may call a writing DB function, and the driver can't tell them apart.

// Neon's own connect-phase flag, plus the proxy's connect-phase phrasings.
const NEON_PRE_SEND =
  /"neon:retryable"\s*:\s*true|Failed to acquire permit|Too many database connection attempts|Control plane request failed|Couldn't connect to compute/i

// Socket failures before any byte of the request was written.
const PRE_SEND_SYSCALLS = new Set(["connect", "getaddrinfo"])
const PRE_SEND_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"])
const PRE_SEND_MESSAGE = /before secure TLS connection was established/i

// A genuine Postgres error arrives with a 5-char SQLSTATE (e.g. "23505"
// unique-violation, "42703" undefined-column): it ran. Node system error codes
// (ECONNRESET, …) are longer and don't match.
function hasPostgresSqlState(code: unknown): boolean {
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
}

type ErrNode = { code?: unknown; syscall?: unknown; message?: unknown; sourceError?: unknown; cause?: unknown; errors?: unknown }

function* causeChain(err: unknown, depth = 0): Generator<ErrNode> {
  if (!err || typeof err !== "object" || depth > 6) return
  const e = err as ErrNode
  yield e
  yield* causeChain(e.sourceError, depth + 1)
  yield* causeChain(e.cause, depth + 1)
  if (Array.isArray(e.errors)) for (const sub of e.errors) yield* causeChain(sub, depth + 1)
}

/** True only when the failed call provably never reached Postgres. */
export function isRetryableNeonError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const top = err as ErrNode
  if (hasPostgresSqlState(top.code)) return false
  if (NEON_PRE_SEND.test(String(top.message ?? ""))) return true
  for (const e of causeChain(err)) {
    if (typeof e.code === "string" && PRE_SEND_CODES.has(e.code)) return true
    if (typeof e.syscall === "string" && PRE_SEND_SYSCALLS.has(e.syscall)) return true
    if (PRE_SEND_MESSAGE.test(String(e.message ?? ""))) return true
  }
  return false
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type RetryOptions = {
  /** Max total attempts (including the first). Default 4. */
  attempts?: number
  /** Base backoff in ms; doubles each attempt. Default 100. */
  baseDelayMs?: number
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

export async function withDbRetry<T>(run: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4
  const baseDelayMs = opts.baseDelayMs ?? 100
  const sleep = opts.sleep ?? defaultSleep

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run()
    } catch (err) {
      lastErr = err
      if (attempt >= attempts || !isRetryableNeonError(err)) throw err
      // Exponential backoff with jitter so concurrent functions don't retry in
      // lockstep and worsen the connection storm.
      const backoff = baseDelayMs * 2 ** (attempt - 1)
      const jitter = Math.floor(Math.random() * baseDelayMs)
      await sleep(backoff + jitter)
    }
  }
  throw lastErr
}
