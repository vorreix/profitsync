import { describe, it, expect, vi } from "vitest"
import { isRetryableNeonError, withDbRetry } from "./retry"

// Shapes mirror real production NeonDbError objects (see Neon HTTP driver). The
// transient ones embed the server JSON — including "neon:retryable":true — in
// `message`, and carry no Postgres SQLSTATE `code`.
const permitError = {
  name: "NeonDbError",
  code: undefined,
  message:
    'Server error (HTTP status 500): {"message":"Failed to acquire permit to connect to the database. Too many database connection attempts are currently ongoing.","code":"","neon:retryable":true}',
}
const controlPlaneError = {
  name: "NeonDbError",
  code: undefined,
  message:
    'Server error (HTTP status 500): {"message":"Control plane request failed","code":"","neon:retryable":true}',
}
// Fetch failures, shaped exactly as @neondatabase/serverless 0.10 throws them
// (captured from the real driver): EVERY one says "Error connecting to
// database: fetch failed"; only the cause chain says where it failed.
const fetchFailure = (cause: unknown) => ({
  name: "NeonDbError",
  code: undefined,
  message: "Error connecting to database: fetch failed",
  sourceError: Object.assign(new TypeError("fetch failed"), { cause }),
})
const connectRefused = fetchFailure(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED", syscall: "connect" }))
const dnsFailure = fetchFailure(Object.assign(new Error("getaddrinfo EAI_AGAIN ep.neon.tech"), { code: "EAI_AGAIN", syscall: "getaddrinfo" }))
const connectTimeout = fetchFailure(Object.assign(new Error("Connect Timeout Error"), { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" }))
// Happy-eyeballs: every address timed out, wrapped in an AggregateError.
const allAddressesTimedOut = fetchFailure(
  Object.assign(new AggregateError([
    Object.assign(new Error("connect ETIMEDOUT ::1:443"), { code: "ETIMEDOUT", syscall: "connect" }),
    Object.assign(new Error("connect ETIMEDOUT 127.0.0.1:443"), { code: "ETIMEDOUT", syscall: "connect" }),
  ]), { code: "ETIMEDOUT" }),
)
// AFTER the request was written — the server may have committed.
const otherSideClosed = fetchFailure(Object.assign(new Error("other side closed"), { name: "SocketError", code: "UND_ERR_SOCKET" }))
const resetAfterSend = fetchFailure(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }))
const readTimeout = fetchFailure(Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT", syscall: "read" }))
const socketHangUp = { message: "socket hang up", code: "ECONNRESET" }
const gatewayTimeout = { name: "NeonDbError", code: undefined, message: "Server error (HTTP status 504): Gateway Timeout" }

// Genuine SQL errors carry a 5-char Postgres SQLSTATE and must NEVER be retried.
const uniqueViolation = {
  name: "NeonDbError",
  code: "23505",
  message: 'duplicate key value violates unique constraint "organizations_slug_key"',
}
const undefinedColumn = {
  name: "NeonDbError",
  code: "42703",
  message: 'column "bogus" does not exist',
}

describe("isRetryableNeonError", () => {
  it("flags transient connection-permit errors as retryable", () => {
    expect(isRetryableNeonError(permitError)).toBe(true)
  })

  it("flags control-plane resume failures as retryable", () => {
    expect(isRetryableNeonError(controlPlaneError)).toBe(true)
  })

  it("flags failures before a connection was opened as retryable", () => {
    expect(isRetryableNeonError(connectRefused)).toBe(true)
    expect(isRetryableNeonError(dnsFailure)).toBe(true)
    expect(isRetryableNeonError(connectTimeout)).toBe(true)
    expect(isRetryableNeonError(allAddressesTimedOut)).toBe(true)
  })

  // MC-060: these may come AFTER the server committed — a replay of
  // `current_balance = current_balance + x` would apply it twice.
  it("never retries a failure after the request was sent", () => {
    expect(isRetryableNeonError(otherSideClosed)).toBe(false)
    expect(isRetryableNeonError(resetAfterSend)).toBe(false)
    expect(isRetryableNeonError(readTimeout)).toBe(false)
    expect(isRetryableNeonError(socketHangUp)).toBe(false)
    expect(isRetryableNeonError(gatewayTimeout)).toBe(false)
    expect(isRetryableNeonError({ message: "Connection terminated unexpectedly" })).toBe(false)
  })

  it("never retries genuine SQL errors that carry a Postgres SQLSTATE", () => {
    expect(isRetryableNeonError(uniqueViolation)).toBe(false)
    expect(isRetryableNeonError(undefinedColumn)).toBe(false)
  })

  it("does not retry arbitrary errors with no retryable signal", () => {
    expect(isRetryableNeonError(new Error("boom"))).toBe(false)
    expect(isRetryableNeonError(null)).toBe(false)
    expect(isRetryableNeonError(undefined)).toBe(false)
    expect(isRetryableNeonError("nope")).toBe(false)
  })
})

describe("withDbRetry", () => {
  const noSleep = vi.fn(async (_ms: number) => {})

  it("returns the result without retrying when the call succeeds", async () => {
    const run = vi.fn(async () => "ok")
    await expect(withDbRetry(run, { sleep: noSleep })).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("retries a retryable error and succeeds on a later attempt", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(permitError)
      .mockRejectedValueOnce(controlPlaneError)
      .mockResolvedValueOnce("recovered")
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(withDbRetry(run, { sleep })).resolves.toBe("recovered")
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    // Backoff grows between attempts (exponential).
    const [first] = sleep.mock.calls[0]
    const [second] = sleep.mock.calls[1]
    expect(second).toBeGreaterThan(first)
  })

  it("gives up after the attempt cap and rethrows the last retryable error", async () => {
    const run = vi.fn().mockRejectedValue(permitError)
    await expect(withDbRetry(run, { attempts: 3, sleep: noSleep })).rejects.toBe(permitError)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it("runs a money statement once when the network fails after sending it", async () => {
    const run = vi.fn().mockRejectedValue(otherSideClosed)
    await expect(withDbRetry(run, { sleep: noSleep })).rejects.toBe(otherSideClosed)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("surfaces a duplicate key as the conflict it is (a replay never follows a sent attempt)", async () => {
    const run = vi.fn().mockRejectedValueOnce(permitError).mockRejectedValueOnce(uniqueViolation)
    await expect(withDbRetry(run, { sleep: noSleep })).rejects.toBe(uniqueViolation)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("rethrows a non-retryable error immediately without sleeping", async () => {
    const run = vi.fn().mockRejectedValue(uniqueViolation)
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(withDbRetry(run, { sleep })).rejects.toBe(uniqueViolation)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
