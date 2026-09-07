import { describe, expect, it } from "vitest"
import {
  ALWAYS_FETCH,
  basePath,
  canPersist,
  hasFanoutRule,
  invalidationFor,
  policyFor,
} from "./api-cache"

const drops = (write: string, read: string) => {
  const inv = invalidationFor(write)
  return inv.kind === "all" || inv.prefixes.some((p) => read.startsWith(p))
}

describe("basePath", () => {
  it("strips the query string", () => {
    expect(basePath("/api/transactions?clientId=1&page=2")).toBe("/api/transactions")
    expect(basePath("/api/cards")).toBe("/api/cards")
  })
})

describe("policyFor", () => {
  it("only ever persists config and the organization list", () => {
    expect(canPersist("/api/organizations")).toBe(true)
    expect(canPersist("/api/categories")).toBe(true)
    expect(canPersist("/api/tags")).toBe(true)
    for (const money of ["/api/transactions", "/api/wealth/accounts", "/api/cards", "/api/spaces", "/api/analytics", "/api/budgets"]) {
      expect(canPersist(money), money).toBe(false)
    }
  })

  it("never persists a body that decides which workspace you are in", () => {
    // /api/profile carries current_organization_id. Off disk it puts the user
    // back in the workspace they left on another device, and a personal-only
    // route redirects them away before the fresh copy lands.
    expect(canPersist("/api/profile")).toBe(false)
    // Same for the one that opens the admin console.
    expect(canPersist("/api/admin/me")).toBe(false)
    // Both still get a long in-memory window — that is where the win is.
    expect(policyFor("/api/profile").fresh).toBeGreaterThanOrEqual(60_000)
  })

  it("never persists a per-organization list under an identity-looking prefix", () => {
    // /api/organizations/:id/members is org data, not identity — a stale member
    // list off disk would show someone a role they no longer have.
    expect(canPersist("/api/organizations/abc/members")).toBe(false)
    expect(policyFor("/api/organizations/abc/members").cls).toBe("derived")
  })

  it("always refetches the reads that write money server-side", () => {
    for (const p of ALWAYS_FETCH) expect(policyFor(p).alwaysFetch, p).toBe(true)
    // Including nested paths under those prefixes and with a query string.
    expect(policyFor("/api/cards/abc/summary").alwaysFetch).toBe(true)
    expect(policyFor("/api/transactions?cardId=x").alwaysFetch).toBe(true)
    expect(policyFor("/api/spaces/abc/auto-save").alwaysFetch).toBe(true)
    // And not the ones that don't.
    expect(policyFor("/api/profile").alwaysFetch).toBe(false)
    expect(policyFor("/api/analytics").alwaysFetch).toBe(false)
  })

  it("bounds how stale a money-materialising read may get", () => {
    // These routes run autopay and post due recurring transactions while
    // serving. src/lib/api.ts forces the request out on its own floor, but the
    // policy must never invite a long reuse window or a copy on disk that could
    // outlive the tab.
    for (const p of ALWAYS_FETCH) {
      const pol = policyFor(p)
      expect(pol.persist, p).toBe(false)
      expect(pol.fresh, p).toBeLessThanOrEqual(30_000)
      expect(pol.maxStale, p).toBeLessThanOrEqual(120_000)
    }
  })

  it("refuses to reuse one-shot and metered responses", () => {
    for (const p of ["/api/attachments/1", "/api/billing/invoice-pdf?id=1", "/api/ai/assistant", "/api/wealth/bank-search?q=hs"]) {
      const pol = policyFor(p)
      expect(pol.fresh, p).toBe(0)
      expect(pol.maxStale, p).toBe(0)
      expect(pol.persist, p).toBe(false)
    }
  })

  it("keeps bank-search out of the money class despite the /api/wealth prefix", () => {
    expect(policyFor("/api/wealth/bank-search?q=in").cls).toBe("no-store")
  })

  it("reuses the AI credit balance without reusing an AI answer", () => {
    // Four components read the quota on one page load; none of them is a charge.
    expect(policyFor("/api/ai/quota").fresh).toBeGreaterThan(0)
    expect(policyFor("/api/ai/assistant").fresh).toBe(0)
  })

  it("treats /api/admin/me as identity but the rest of /api/admin as cross-org", () => {
    expect(policyFor("/api/admin/me").persist).toBe(true)
    const stats = policyFor("/api/admin/stats")
    expect(stats.persist).toBe(false)
    expect(stats.maxStale).toBe(0)
  })

  it("never serves a stale body to a reader that writes money off it", () => {
    // BudgetProvider POSTs /api/budgets/v2/sync when this says sync_required.
    expect(policyFor("/api/budgets/v2").maxStale).toBe(0)
    expect(policyFor("/api/budgets/v2/overview").maxStale).toBe(0)
  })

  it("never paints the attention banner stale, and never puts it on disk", () => {
    // It says "card payment overdue" on every screen; its whole claim over the
    // notification log is that it is true right now.
    const pol = policyFor("/api/alerts")
    expect(pol.maxStale).toBe(0)
    expect(pol.persist).toBe(false)
    // …and it must not be an ALWAYS_FETCH route: deriving it may never
    // materialize money, or rendering a banner would file statements.
    expect(pol.alwaysFetch).toBe(false)
  })

  it("drops the attention banner whenever money moves", () => {
    for (const write of ["/api/transactions", "/api/wealth/transfer", "/api/cards/1", "/api/recurring/1", "/api/budgets/v2/sync"]) {
      expect(drops(write, "/api/alerts"), write).toBe(true)
    }
  })

  it("allows a short stale window on ordinary money reads", () => {
    const pol = policyFor("/api/wealth/accounts")
    expect(pol.fresh).toBeGreaterThan(0)
    expect(pol.maxStale).toBeGreaterThan(pol.fresh)
    expect(pol.persist).toBe(false)
  })
})

describe("invalidationFor", () => {
  it("drops every balance-bearing read when money moves", () => {
    for (const write of ["/api/transactions", "/api/transactions/1", "/api/wealth/transfer", "/api/cards/1", "/api/spaces/1/auto-save"]) {
      for (const read of ["/api/transactions", "/api/wealth/accounts", "/api/cards", "/api/spaces", "/api/analytics", "/api/calendar", "/api/flow", "/api/budgets", "/api/trash"]) {
        expect(drops(write, read), `${write} → ${read}`).toBe(true)
      }
    }
  })

  it("drops the ledger when a category is renamed", () => {
    // A rename rewrites transactions.category across the org and moves budget
    // spend between envelopes — config on the surface, money underneath.
    for (const read of ["/api/transactions", "/api/analytics", "/api/budgets", "/api/flow", "/api/calendar", "/api/categories"]) {
      expect(drops("/api/categories/1", read), read).toBe(true)
    }
  })

  it("drops the client and quotation lists a category rename rewrote", () => {
    // PUT /api/categories/combined rewrites `category` on transactions, clients
    // AND quotations in one statement each.
    for (const read of ["/api/clients", "/api/quotations"]) {
      expect(drops("/api/categories/combined?name=Rent", read), read).toBe(true)
    }
  })

  it("does not purge the world for a routine admin note", () => {
    const inv = invalidationFor("/api/admin/billing-attempts/1")
    expect(inv.kind).toBe("prefixes")
    expect(drops("/api/admin/billing-attempts/1", "/api/transactions")).toBe(false)
    expect(drops("/api/admin/billing-attempts/1", "/api/admin/billing-attempts")).toBe(true)
  })

  it("keeps identity writes narrow", () => {
    const inv = invalidationFor("/api/legal/accept")
    expect(inv.kind).toBe("prefixes")
    // The boot-time legal accept must NOT wipe the money cache.
    expect(drops("/api/legal/accept", "/api/transactions")).toBe(false)
    expect(drops("/api/legal/accept", "/api/profile")).toBe(true)
  })

  it("purges everything when the org, the plan, or the account itself changes", () => {
    for (const write of ["/api/organizations/switch", "/api/onboarding", "/api/billing/create-subscription", "/api/billing/cancel", "/api/account/delete/confirm", "/api/admin/plans", "/api/admin/roles/1", "/api/admin/organizations/bulk-delete"]) {
      expect(invalidationFor(write).kind, write).toBe("all")
    }
  })

  it("purges everything for an unmapped path", () => {
    expect(invalidationFor("/api/something-invented-tomorrow").kind).toBe("all")
    expect(hasFanoutRule("/api/something-invented-tomorrow")).toBe(false)
  })

  it("has an explicit rule for every write path the app uses today", () => {
    const known = [
      "/api/transactions", "/api/transactions/1/attachments", "/api/clients", "/api/clients/bulk-delete",
      "/api/quotations", "/api/quotations/1/convert", "/api/organizations", "/api/organizations/switch",
      "/api/organizations/1/members", "/api/invitations/tok", "/api/profile", "/api/onboarding", "/api/legal/accept",
      "/api/categories", "/api/tags", "/api/wealth/accounts", "/api/wealth/transfer", "/api/wealth-accounts/1",
      "/api/cards", "/api/cards/reorder", "/api/recurring/1", "/api/spaces/1", "/api/budgets", "/api/trash/restore",
      "/api/notifications/read", "/api/referrals/apply", "/api/billing/change-plan", "/api/account/delete/confirm",
      "/api/admin/users",
    ]
    const missing = known.filter((p) => !hasFanoutRule(p))
    expect(missing, `no fanout rule: ${missing.join(", ")}`).toEqual([])
  })

  it("matches on path segments, not bare string prefixes", () => {
    // /api/cardsomething must not inherit the /api/cards rule.
    expect(hasFanoutRule("/api/cardsomething")).toBe(false)
  })
})
