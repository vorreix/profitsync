import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DATA_CHANGED_EVENT } from "./data-events"

// The store keys everything by the JWT subject, so the tests need real-shaped
// tokens rather than opaque strings.
const tokenFor = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`
const A = tokenFor("user_a")
const B = tokenFor("user_b")

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
    _map: map,
  }
}

let store: ReturnType<typeof fakeStorage>
let calls: string[]
let bodies: Map<string, unknown>
let events: string[]

/** A fresh module instance — the cache is module state, so every test needs its own. */
async function loadApi(keepStorage = false, org: string | null = "org_1") {
  if (!keepStorage) store = fakeStorage()
  vi.stubGlobal("localStorage", store)
  const listeners = new Set<(e: { type: string; detail?: unknown }) => void>()
  vi.stubGlobal("window", {
    addEventListener: (_t: string, fn: never) => listeners.add(fn),
    removeEventListener: (_t: string, fn: never) => listeners.delete(fn),
    dispatchEvent: (e: { type: string; detail?: { path?: string } }) => {
      if (e.type === DATA_CHANGED_EVENT) events.push(e.detail?.path ?? "")
      return true
    },
  })
  vi.stubGlobal("CustomEvent", class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail } })
  vi.stubGlobal("Event", class { type: string; constructor(t: string) { this.type = t } })
  vi.resetModules()
  const api = await import("./api")
  // Real boots have an org resolved almost immediately, and nothing is written
  // to disk until one is — see "does not persist a body fetched before the
  // workspace is known".
  if (org) api.setActiveOrgId(org)
  return api
}

/** Only the cache's own keys — `ps_active_org` shares the same store. */
const diskKeys = () => [...store._map.keys()].filter((k) => k.startsWith("ps_apic"))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  calls = []
  events = []
  bodies = new Map()
  store = fakeStorage()
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${path}`)
    return {
      ok: true,
      status: 200,
      json: async () => bodies.get(path) ?? { v: 1 },
      text: async () => "",
    }
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const gets = () => calls.filter((c) => c.startsWith("GET "))

describe("read path", () => {
  it("serves a second read of the same path without touching the network", async () => {
    const api = await loadApi()
    await api.apiGet("/api/analytics", A)
    await api.apiGet("/api/analytics", A)
    expect(gets()).toHaveLength(1)
  })

  it("collapses concurrent reads into one request", async () => {
    const api = await loadApi()
    await Promise.all([api.apiGet("/api/analytics", A), api.apiGet("/api/analytics", A), api.apiGet("/api/analytics", A)])
    expect(gets()).toHaveLength(1)
  })

  it("paints the stale copy immediately and corrects it behind the paint", async () => {
    const api = await loadApi()
    bodies.set("/api/analytics", { v: 1 })
    expect(await api.apiGet("/api/analytics", A)).toEqual({ v: 1 })

    // Past `fresh` but inside the stale window.
    vi.setSystemTime(Date.now() + 45_000)
    bodies.set("/api/analytics", { v: 2 })
    // The caller gets the old body with no await on the network...
    expect(await api.apiGet("/api/analytics", A)).toEqual({ v: 1 })
    // ...and the refresh lands behind it, announcing itself the way a mutation does.
    await vi.waitFor(() => expect(events).toContain("/api/analytics"))
    expect(api.peekApiCache("/api/analytics")).toEqual({ v: 2 })
    expect(gets()).toHaveLength(2)
  })

  it("says nothing when the refreshed copy is identical", async () => {
    const api = await loadApi()
    bodies.set("/api/analytics", { v: 1 })
    await api.apiGet("/api/analytics", A)
    vi.setSystemTime(Date.now() + 45_000)
    await api.apiGet("/api/analytics", A)
    await vi.waitFor(() => expect(gets()).toHaveLength(2))
    expect(events).toEqual([])
  })

  it("keeps sending the request for a read that materialises money", async () => {
    const api = await loadApi()
    // /api/cards runs card sync (statements, autopay) while it serves.
    await api.apiGet("/api/cards", A)
    vi.setSystemTime(Date.now() + 6_000) // inside `fresh`, past the sync floor
    await api.apiGet("/api/cards", A)
    await vi.waitFor(() => expect(gets()).toHaveLength(2))

    // A read with no server-side side effect stays quiet over the same window.
    calls.length = 0
    await api.apiGet("/api/analytics", A)
    vi.setSystemTime(Date.now() + 6_000)
    await api.apiGet("/api/analytics", A)
    expect(gets()).toHaveLength(1)
  })

  it("never reuses a one-shot response", async () => {
    const api = await loadApi()
    await api.apiGet("/api/attachments/1", A)
    await api.apiGet("/api/attachments/1", A)
    expect(gets()).toHaveLength(2)
  })

  it("stops hammering an endpoint whose refresh keeps failing", async () => {
    const api = await loadApi()
    await api.apiGet("/api/analytics", A)
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${path}`)
      return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) }
    }))
    vi.setSystemTime(Date.now() + 45_000)
    await api.apiGet("/api/analytics", A)
    await vi.waitFor(() => expect(gets()).toHaveLength(2))
    // Still inside the backoff: the stale body is served, no second attempt.
    await api.apiGet("/api/analytics", A)
    expect(gets()).toHaveLength(2)
    // The caller is never handed the background failure.
    expect(await api.apiGet("/api/analytics", A)).toEqual({ v: 1 })
  })
})

describe("identity", () => {
  it("never serves one user's rows to another", async () => {
    const api = await loadApi()
    bodies.set("/api/analytics", { owner: "a" })
    expect(await api.apiGet("/api/analytics", A)).toEqual({ owner: "a" })
    bodies.set("/api/analytics", { owner: "b" })
    expect(await api.apiGet("/api/analytics", B)).toEqual({ owner: "b" })
    expect(gets()).toHaveLength(2)
  })

  it("takes the previous user's shell off disk when someone else signs in", async () => {
    const api = await loadApi()
    await api.apiGet("/api/organizations", A)
    expect(diskKeys().some((k) => k.includes("user_a"))).toBe(true)
    await api.apiGet("/api/organizations", B)
    expect(diskKeys().some((k) => k.includes("user_a"))).toBe(false)
    expect(diskKeys().some((k) => k.includes("user_b"))).toBe(true)
  })

  it("leaves nothing behind on sign-out", async () => {
    const api = await loadApi()
    await api.apiGet("/api/organizations", A)
    api.purgeApiCache()
    expect(diskKeys()).toHaveLength(0)
    await api.apiGet("/api/organizations", A)
    expect(gets()).toHaveLength(2)
  })
})

describe("persistence", () => {
  it("does not refetch the boot requests when the workspace resolves", async () => {
    const api = await loadApi(false, null)
    // The shape of a real boot: profile + org list go out with no x-org-id,
    // then the org they named becomes active.
    await api.apiGet("/api/organizations", A)
    await api.apiGet("/api/profile", A)
    expect(gets()).toHaveLength(2)

    api.setActiveOrgId("org_1")
    await api.apiGet("/api/organizations", A)
    await api.apiGet("/api/profile", A)
    expect(gets()).toHaveLength(2) // adopted, not fetched again
    // …and now they are on disk under the workspace they actually belong to.
    expect(diskKeys().some((k) => k.includes("|org_1|/api/organizations"))).toBe(true)
  })

  it("does not persist a body fetched before the workspace is known", async () => {
    const api = await loadApi(false, null)
    // No org resolved yet: the server answered for whatever the profile said,
    // so this body belongs to a workspace the key does not name.
    await api.apiGet("/api/categories", A)
    expect(diskKeys()).toHaveLength(0)

    api.setActiveOrgId("org_1")
    await api.apiGet("/api/categories", A)
    expect(diskKeys().some((k) => k.includes("|org_1|"))).toBe(true)
  })

  it("paints identity and config from disk on a cold start", async () => {
    const api = await loadApi()
    bodies.set("/api/organizations", [{ id: "o1" }])
    bodies.set("/api/categories", { list: [] })
    await api.apiGet("/api/organizations", A)
    await api.apiGet("/api/categories", A)

    // A new tab: fresh module, same disk.
    calls.length = 0
    const api2 = await loadApi(true)
    expect(await api2.apiGet("/api/organizations", A)).toEqual([{ id: "o1" }])
    expect(await api2.apiGet("/api/categories", A)).toEqual({ list: [] })
    expect(gets()).toHaveLength(0)
  })

  it("never writes money — or the active workspace — to disk", async () => {
    const api = await loadApi()
    for (const p of ["/api/transactions", "/api/wealth/accounts", "/api/cards", "/api/spending-budgets", "/api/analytics", "/api/profile", "/api/admin/me"]) {
      await api.apiGet(p, A)
    }
    expect(diskKeys()).toEqual([])

    // And a cold start refetches every one of them.
    calls.length = 0
    const api2 = await loadApi(true)
    await api2.apiGet("/api/transactions", A)
    expect(gets()).toHaveLength(1)
  })

  it("survives a browser that refuses storage", async () => {
    store = {
      get length(): number { throw new Error("denied") },
      key: () => { throw new Error("denied") },
      getItem: () => { throw new Error("denied") },
      setItem: () => { throw new Error("denied") },
      removeItem: () => { throw new Error("denied") },
      clear: () => { throw new Error("denied") },
      _map: new Map(),
    }
    const api = await loadApi(true)
    expect(await api.apiGet("/api/organizations", A)).toEqual({ v: 1 })
    await api.apiGet("/api/organizations", A)
    expect(gets()).toHaveLength(1)
  })

  it("refuses to store a body too big to be worth the space", async () => {
    const api = await loadApi()
    bodies.set("/api/categories", { blob: "x".repeat(300_000) })
    await api.apiGet("/api/categories", A)
    expect(diskKeys()).toHaveLength(0)
  })
})

describe("write path", () => {
  it("drops every read a money write made wrong, and nothing else", async () => {
    const api = await loadApi()
    await api.apiGet("/api/organizations", A)
    await api.apiGet("/api/wealth/accounts", A)
    await api.apiGet("/api/analytics", A)
    calls.length = 0

    await api.apiPost("/api/transactions", A, { amount: 1 })

    // The balance-bearing reads are gone...
    await api.apiGet("/api/wealth/accounts", A)
    await api.apiGet("/api/analytics", A)
    expect(gets()).toHaveLength(2)
    // ...and the shell was left alone.
    calls.length = 0
    await api.apiGet("/api/organizations", A)
    expect(gets()).toHaveLength(0)
  })

  it("keeps the money cache warm through the boot-time legal accept", async () => {
    const api = await loadApi()
    await api.apiGet("/api/wealth/accounts", A)
    calls.length = 0
    await api.apiPost("/api/legal/accept", A, {})
    await api.apiGet("/api/wealth/accounts", A)
    expect(gets()).toHaveLength(0)
  })

  it("purges disk and memory when the plan changes", async () => {
    const api = await loadApi()
    await api.apiGet("/api/organizations", A)
    expect(diskKeys()).toHaveLength(1)
    await api.apiPost("/api/billing/change-plan", A, {})
    expect(diskKeys()).toHaveLength(0)
  })

  it("purges everything for a path nobody has mapped", async () => {
    const api = await loadApi()
    await api.apiGet("/api/organizations", A)
    await api.apiPost("/api/some-new-feature", A, {})
    expect(diskKeys()).toHaveLength(0)
    calls.length = 0
    await api.apiGet("/api/organizations", A)
    expect(gets()).toHaveLength(1)
  })

  it("does not let a GET in flight during a write repopulate the stale body", async () => {
    const api = await loadApi()
    bodies.set("/api/analytics", { v: "before" })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${path}`)
      if ((init?.method ?? "GET") === "GET") await gate
      return { ok: true, status: 200, json: async () => bodies.get(path) ?? { v: 1 }, text: async () => "" }
    }))

    const slow = api.apiGet("/api/analytics", A)
    await api.apiPost("/api/transactions", A, {})
    release()
    await slow

    expect(api.peekApiCache("/api/analytics")).toBeUndefined()
  })
})
