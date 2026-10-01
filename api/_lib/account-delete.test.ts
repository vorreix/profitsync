import { beforeEach, describe, expect, it, vi } from "vitest"

// DB-free: a fake db that records every write, a stubbed teardown and Clerk.
const h = vi.hoisted(() => ({
  writes: [] as string[],
  torn: [] as string[],
  clerkDeletes: 0,
  failing: new Set<string>(),
}))

const chain = (value: unknown) => {
  const c: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(value).then(ok, ko),
  }
  for (const m of ["from", "where"]) c[m] = () => c
  return c
}

vi.mock("../../src/lib/db/index.js", () => ({
  db: {
    select: () => chain([{ id: "org-paid" }, { id: "org-other" }]),
    delete: () => { h.writes.push("delete"); return chain([]) },
  },
}))
vi.mock("./admin-org-delete.js", () => ({
  teardownOrganization: async (id: string, opts: { abortOnBillingFailure?: boolean } = {}) => {
    h.torn.push(id)
    const failed = h.failing.has(id)
    return {
      id,
      deleted: !(failed && opts.abortOnBillingFailure),
      dodo: failed ? { provider: "dodo", ok: false, error: "Dodo 503" } : { provider: "none" },
    }
  },
}))
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ users: { deleteUser: async () => { h.clerkDeletes++ } } }),
}))

const { deleteUserAccount } = await import("./account-delete.js")

beforeEach(() => {
  h.writes = []
  h.torn = []
  h.clerkDeletes = 0
  h.failing = new Set(["org-paid"])
})

describe("deleteUserAccount when a workspace's Dodo cancel fails", () => {
  it("self-serve: stops before the profile and the login, so the user can retry", async () => {
    const r = await deleteUserAccount("user-1", { abortOnBillingFailure: true })
    expect(r.billingFailed).toBe(true)
    expect(r.clerkDeleted).toBe(false)
    expect(h.torn).toEqual(["org-paid"])
    expect(h.writes).toEqual([])
    expect(h.clerkDeletes).toBe(0)
  })

  it("admin (default): still force-deletes everything and reports the failure", async () => {
    const r = await deleteUserAccount("user-1")
    expect(r.billingFailed).toBeUndefined()
    expect(r.clerkDeleted).toBe(true)
    expect(h.torn).toEqual(["org-paid", "org-other"])
    expect(r.organizations[0].dodo).toMatchObject({ provider: "dodo", ok: false })
  })

  it("self-serve with billing stopped everywhere deletes the account", async () => {
    h.failing = new Set()
    const r = await deleteUserAccount("user-1", { abortOnBillingFailure: true })
    expect(r).toMatchObject({ clerkDeleted: true })
    expect(h.writes.length).toBeGreaterThan(0)
  })
})
