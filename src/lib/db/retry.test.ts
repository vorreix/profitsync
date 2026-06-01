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
const networkError = { message: "fetch failed", code: "ECONNRESET" }

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

  it("flags low-level network errors as retryable", () => {
    expect(isRetryableNeonError(networkError)).toBe(true)
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

  it("rethrows a non-retryable error immediately without sleeping", async () => {
    const run = vi.fn().mockRejectedValue(uniqueViolation)
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(withDbRetry(run, { sleep })).rejects.toBe(uniqueViolation)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
