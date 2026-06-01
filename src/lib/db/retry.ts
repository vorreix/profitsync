// Transient-error retry for the Neon HTTP driver.
//
// Neon's serverless SQL endpoint occasionally returns transient failures —
// connection-permit exhaustion under bursty load, or "control plane request
// failed" while a suspended compute resumes. Neon flags these with
// `"neon:retryable": true` in the response body (which the driver embeds in the
// error message). The driver does NOT retry on its own, so without this each
// blip surfaces to users as a 500. We retry only these transient errors with
// exponential backoff + jitter; genuine SQL errors are rethrown immediately.

// Signals that an error is a transient connectivity failure worth retrying.
// `"neon:retryable":true` is Neon's own canonical flag; the rest cover the
// phrasings we've observed plus low-level socket/fetch failures.
const RETRYABLE_HINTS =
  /"neon:retryable"\s*:\s*true|Failed to acquire permit|Too many database connection attempts|Control plane request failed|Couldn't connect to compute|terminating connection due to|connection terminated|reset by peer|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i

// A genuine Postgres error arrives with a 5-char SQLSTATE (e.g. "23505"
// unique-violation, "42703" undefined-column). Those are deterministic — never
// retry them. Node system error codes (ECONNRESET, …) are longer and don't match.
function hasPostgresSqlState(code: unknown): boolean {
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
}

export function isRetryableNeonError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: unknown; message?: string; sourceError?: { message?: string } }
  if (hasPostgresSqlState(e.code)) return false
  const message = `${e.message ?? ""} ${e.sourceError?.message ?? ""}`
  return RETRYABLE_HINTS.test(message)
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
