import { beforeEach, describe, expect, it, vi } from "vitest"

// DB-free: a fake db that records every write, and a stubbed Dodo cancel.
const h = vi.hoisted(() => ({
  writes: [] as string[],
  stop: { provider: "dodo", ok: false, error: "Dodo 503: unavailable" } as Record<string, unknown>,
}))

const chain = (value: unknown) => {
  const c: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(value).then(ok, ko),
  }
  for (const m of ["from", "where", "limit", "orderBy", "set", "returning"]) c[m] = () => c
  return c
}

vi.mock("../../src/lib/db/index.js", () => ({
  db: {
    select: () => chain([{ id: "sub-1", provider: "dodo", providerSubscriptionId: "sub_dodo" }]),
    update: () => { h.writes.push("update"); return chain([]) },
    delete: () => { h.writes.push("delete"); return chain([{ id: "org-1" }]) },
  },
}))
vi.mock("./admin-billing.js", () => ({ stopDodoBilling: async () => h.stop }))

const { teardownOrganization } = await import("./admin-org-delete.js")

beforeEach(() => {
  h.writes = []
  h.stop = { provider: "dodo", ok: false, error: "Dodo 503: unavailable" }
  vi.restoreAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("teardownOrganization when Dodo won't cancel", () => {
  it("touches nothing locally with abortOnBillingFailure (the owner delete)", async () => {
    const r = await teardownOrganization("org-1", { abortOnBillingFailure: true })
    expect(r).toMatchObject({ deleted: false, dodo: { provider: "dodo", ok: false } })
    expect(h.writes).toEqual([])
    expect(console.error).toHaveBeenCalled()
  })

  it("still force-deletes by default (admin + account deletion) and reports the failure", async () => {
    const r = await teardownOrganization("org-1")
    expect(r).toMatchObject({ deleted: true, dodo: { ok: false } })
    expect(h.writes).toContain("delete")
  })

  it("deletes when the cancel succeeded", async () => {
    h.stop = { provider: "dodo", ok: true }
    const r = await teardownOrganization("org-1", { abortOnBillingFailure: true })
    expect(r.deleted).toBe(true)
    expect(console.error).not.toHaveBeenCalled()
  })
})
