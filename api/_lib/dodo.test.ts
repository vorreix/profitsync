import { createHmac } from "crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isDodoConfigured, verifyWebhookSignature, type DodoEnv } from "./dodo"

// These env vars drive per-environment credential resolution; snapshot and clear
// them around every test so cases don't leak into each other.
const ENV_KEYS = [
  "DODO_PAYMENTS_ENVIRONMENT",
  "DODO_PAYMENTS_API_KEY",
  "DODO_PAYMENTS_API_KEY_TEST",
  "DODO_PAYMENTS_API_KEY_LIVE",
  "DODO_PAYMENTS_WEBHOOK_SECRET",
  "DODO_PAYMENTS_WEBHOOK_SECRET_TEST",
  "DODO_PAYMENTS_WEBHOOK_SECRET_LIVE",
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("isDodoConfigured — per-env key resolution", () => {
  it("uses the explicit per-env keys when present", () => {
    process.env.DODO_PAYMENTS_API_KEY_TEST = "sk_test_x"
    process.env.DODO_PAYMENTS_API_KEY_LIVE = "sk_live_x"
    expect(isDodoConfigured("test")).toBe(true)
    expect(isDodoConfigured("live")).toBe(true)
  })

  it("falls back to the legacy single key only for the legacy env (live_mode)", () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "live_mode"
    process.env.DODO_PAYMENTS_API_KEY = "sk_live_legacy"
    expect(isDodoConfigured("live")).toBe(true) // legacy key serves live
    expect(isDodoConfigured("test")).toBe(false) // nothing for test
  })

  it("falls back to the legacy single key only for the legacy env (test_mode)", () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "test_mode"
    process.env.DODO_PAYMENTS_API_KEY = "sk_test_legacy"
    expect(isDodoConfigured("test")).toBe(true)
    expect(isDodoConfigured("live")).toBe(false)
  })

  it("defaults legacy env to test_mode when DODO_PAYMENTS_ENVIRONMENT is unset", () => {
    process.env.DODO_PAYMENTS_API_KEY = "sk_legacy"
    expect(isDodoConfigured("test")).toBe(true)
    expect(isDodoConfigured("live")).toBe(false)
  })

  it("prefers an explicit per-env key over the legacy fallback", () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "live_mode"
    process.env.DODO_PAYMENTS_API_KEY = "sk_live_legacy"
    process.env.DODO_PAYMENTS_API_KEY_TEST = "sk_test_explicit"
    expect(isDodoConfigured("test")).toBe(true) // explicit test key
    expect(isDodoConfigured("live")).toBe(true) // legacy fallback
  })

  it("is false for an env with no key configured", () => {
    expect(isDodoConfigured("test")).toBe(false)
    expect(isDodoConfigured("live")).toBe(false)
  })
})

// Build a Standard-Webhooks signature header for a given secret + payload.
function signWith(secret: string, id: string, timestamp: string, body: string): string {
  const keyBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64")
  const sig = createHmac("sha256", keyBytes).update(`${id}.${timestamp}.${body}`).digest("base64")
  return `v1,${sig}`
}

describe("verifyWebhookSignature — dual-secret detection", () => {
  const TEST_SECRET = "whsec_" + Buffer.from("test-secret-bytes").toString("base64")
  const LIVE_SECRET = "whsec_" + Buffer.from("live-secret-bytes").toString("base64")
  const id = "msg_1"
  const timestamp = "1717200000"
  // The freshness check compares against `now` — pin it to the signed timestamp.
  const now = new Date(1_717_200_000 * 1000)
  const body = JSON.stringify({ type: "subscription.active" })

  it("returns the matched env when the test secret signed it", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_LIVE = LIVE_SECRET
    const result = verifyWebhookSignature(body, { id, timestamp, signature: signWith(TEST_SECRET, id, timestamp, body) }, now)
    expect(result).toEqual({ valid: true, env: "test" satisfies DodoEnv })
  })

  it("returns the matched env when the live secret signed it", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_LIVE = LIVE_SECRET
    const result = verifyWebhookSignature(body, { id, timestamp, signature: signWith(LIVE_SECRET, id, timestamp, body) }, now)
    expect(result).toEqual({ valid: true, env: "live" satisfies DodoEnv })
  })

  it("still verifies a legacy single-secret deployment", () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "live_mode"
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET = LIVE_SECRET
    const result = verifyWebhookSignature(body, { id, timestamp, signature: signWith(LIVE_SECRET, id, timestamp, body) }, now)
    expect(result).toEqual({ valid: true, env: "live" satisfies DodoEnv })
  })

  it("rejects a signature that matches neither secret", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_LIVE = LIVE_SECRET
    const bogus = "whsec_" + Buffer.from("someone-elses-secret").toString("base64")
    const result = verifyWebhookSignature(body, { id, timestamp, signature: signWith(bogus, id, timestamp, body) }, now)
    expect(result).toEqual({ valid: false })
  })

  it("rejects when required headers are missing", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    expect(verifyWebhookSignature(body, { id, timestamp }, now)).toEqual({ valid: false })
  })

  it("rejects a correctly-signed but REPLAYED webhook (timestamp too old)", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    const replayedAt = new Date((1_717_200_000 + 6 * 60) * 1000) // 6 min later
    const result = verifyWebhookSignature(
      body,
      { id, timestamp, signature: signWith(TEST_SECRET, id, timestamp, body) },
      replayedAt,
    )
    expect(result).toEqual({ valid: false })
  })

  it("accepts small clock skew inside the tolerance window", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    const skewed = new Date((1_717_200_000 + 2 * 60) * 1000) // 2 min later
    const result = verifyWebhookSignature(
      body,
      { id, timestamp, signature: signWith(TEST_SECRET, id, timestamp, body) },
      skewed,
    )
    expect(result).toEqual({ valid: true, env: "test" })
  })

  it("rejects a non-numeric timestamp header", () => {
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST = TEST_SECRET
    const result = verifyWebhookSignature(
      body,
      { id, timestamp: "not-a-number", signature: signWith(TEST_SECRET, id, "not-a-number", body) },
      now,
    )
    expect(result).toEqual({ valid: false })
  })

  it("throws when no signing secret is configured at all", () => {
    expect(() => verifyWebhookSignature(body, { id, timestamp, signature: "v1,whatever" }, now)).toThrow(/not configured/)
  })
})
