import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enqueueNotificationTickAt, isWorkerConfigured } from "./worker-jobs.js"

const ENV_KEYS = ["WORKER_BASE_URL", "WORKER_API_TOKEN"] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.WORKER_BASE_URL = "https://worker.test"
  process.env.WORKER_API_TOKEN = "tok"
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

describe("enqueueNotificationTickAt", () => {
  it("no-ops (false) when the worker isn't configured", async () => {
    delete process.env.WORKER_BASE_URL
    expect(isWorkerConfigured()).toBe(false)
    expect(await enqueueNotificationTickAt(new Date(), "b1:2026-01-01T09:00:00.000Z")).toBe(false)
  })

  it("POSTs a one-shot app.trigger job with run_at + dedupe key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response("{}", { status: 200 })
    })
    const when = new Date("2026-08-01T09:30:00.000Z")
    expect(await enqueueNotificationTickAt(when, "b1:occ1")).toBe(true)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://worker.test/v1/jobs")
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok")
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toMatchObject({
      type: "app.trigger",
      run_at: "2026-08-01T09:30:00.000Z",
      dedupe_key: "tick:b1:occ1",
      payload: { path: "/api/cron/notifications" },
    })
  })

  it("swallows worker failures (sweep is the backstop)", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }))
    expect(await enqueueNotificationTickAt(new Date(), "b2:occ")).toBe(false)

    vi.stubGlobal("fetch", async () => {
      throw new Error("connect refused")
    })
    expect(await enqueueNotificationTickAt(new Date(), "b3:occ")).toBe(false)
  })
})
