import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cancelledNowFields,
  dodoEnvForSub,
  FREE_RESET_FIELDS,
  isAlreadyGoneCancelError,
  isDodoSubscription,
  stopDodoBilling,
} from "./admin-billing"

const ENV_KEYS = [
  "DODO_PAYMENTS_ENVIRONMENT",
  "DODO_PAYMENTS_API_KEY",
  "DODO_PAYMENTS_API_KEY_TEST",
  "DODO_PAYMENTS_API_KEY_LIVE",
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
  vi.unstubAllGlobals()
})

// A minimal fetch Response stand-in (cancelSubscription only reads ok/status/text).
function mockResponse(status: number, body = "{}") {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

describe("FREE_RESET_FIELDS", () => {
  it("clears every Dodo-mirror field and pins free/active", () => {
    expect(FREE_RESET_FIELDS).toEqual({
      planKey: "free",
      status: "active",
      billingCycle: null,
      dodoEnvironment: null,
      billingCurrency: null,
      provider: null,
      providerSubscriptionId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      scheduledChange: null,
      cancelAt: null,
      cancelledAt: null,
    })
  })
})

describe("cancelledNowFields", () => {
  it("marks cancelled now and drops any scheduled change", () => {
    const now = new Date("2026-06-08T00:00:00.000Z")
    expect(cancelledNowFields(now)).toEqual({
      status: "cancelled",
      cancelledAt: now,
      cancelAt: now,
      scheduledChange: null,
    })
  })
})

describe("isDodoSubscription", () => {
  it("is true only for a dodo provider with a provider subscription id", () => {
    expect(isDodoSubscription({ provider: "dodo", providerSubscriptionId: "sub_1", dodoEnvironment: "test" })).toBe(true)
  })
  it("is false for stub / manual / free / missing id", () => {
    expect(isDodoSubscription({ provider: "stub", providerSubscriptionId: "stub_x", dodoEnvironment: null })).toBe(false)
    expect(isDodoSubscription({ provider: null, providerSubscriptionId: null, dodoEnvironment: null })).toBe(false)
    expect(isDodoSubscription({ provider: "dodo", providerSubscriptionId: null, dodoEnvironment: "test" })).toBe(false)
  })
})

describe("dodoEnvForSub", () => {
  it("uses the row's snapshot env when present", () => {
    expect(dodoEnvForSub({ dodoEnvironment: "live" })).toBe("live")
    expect(dodoEnvForSub({ dodoEnvironment: "test" })).toBe("test")
  })
  it("falls back to the deployment default when null", () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "live_mode"
    expect(dodoEnvForSub({ dodoEnvironment: null })).toBe("live")
  })
})

describe("isAlreadyGoneCancelError", () => {
  it("treats 404/409 and already-cancelled text as gone (success)", () => {
    expect(isAlreadyGoneCancelError("Dodo 404: not found")).toBe(true)
    expect(isAlreadyGoneCancelError("Dodo 409: conflict")).toBe(true)
    expect(isAlreadyGoneCancelError("Subscription already cancelled")).toBe(true)
    expect(isAlreadyGoneCancelError("subscription not found")).toBe(true)
  })
  it("does NOT swallow real failures", () => {
    expect(isAlreadyGoneCancelError("Dodo 500: server error")).toBe(false)
    expect(isAlreadyGoneCancelError("Dodo 401: unauthorized")).toBe(false)
    expect(isAlreadyGoneCancelError("network timeout")).toBe(false)
  })
})

describe("stopDodoBilling", () => {
  it("is a no-op for non-Dodo rows (never calls fetch)", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const res = await stopDodoBilling({ provider: "stub", providerSubscriptionId: "stub_x", dodoEnvironment: null })
    expect(res).toEqual({ provider: "none" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("is a no-op when Dodo isn't configured for the row's env", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    // dodo provider but no API key configured for "test"
    const res = await stopDodoBilling({ provider: "dodo", providerSubscriptionId: "sub_1", dodoEnvironment: "test" })
    expect(res).toEqual({ provider: "none" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("cancels immediately on Dodo and returns ok", async () => {
    process.env.DODO_PAYMENTS_API_KEY_TEST = "sk_test_x"
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: { method?: string; body?: string }) =>
      mockResponse(200, JSON.stringify({ subscription_id: "sub_1", status: "cancelled" })),
    )
    vi.stubGlobal("fetch", fetchSpy)

    const res = await stopDodoBilling({ provider: "dodo", providerSubscriptionId: "sub_1", dodoEnvironment: "test" })
    expect(res).toEqual({ provider: "dodo", ok: true })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain("test.dodopayments.com/subscriptions/sub_1")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(String(init?.body))).toMatchObject({ status: "cancelled" })
  })

  it("treats an already-gone (404) subscription as success", async () => {
    process.env.DODO_PAYMENTS_API_KEY_TEST = "sk_test_x"
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(404, "not found")))
    const res = await stopDodoBilling({ provider: "dodo", providerSubscriptionId: "sub_gone", dodoEnvironment: "test" })
    expect(res).toEqual({ provider: "dodo", ok: true })
  })

  it("reports a real Dodo failure instead of swallowing it", async () => {
    process.env.DODO_PAYMENTS_API_KEY_TEST = "sk_test_x"
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500, "server error")))
    const res = await stopDodoBilling({ provider: "dodo", providerSubscriptionId: "sub_1", dodoEnvironment: "test" })
    expect(res).toEqual({ provider: "dodo", ok: false, error: expect.stringContaining("500") })
  })
})
