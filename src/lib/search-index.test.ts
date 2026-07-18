import { describe, expect, it } from "vitest"
import { filterLocal, quickActions, searchablePages } from "./search-index"

const t = (key: string) =>
  (({
    "nav.dashboard": "Dashboard",
    "nav.clients": "Clients",
    "nav.transactions": "Transactions",
    "nav.quotations": "Quotations",
    "nav.spaces": "Spaces",
    "nav.admin": "Admin",
    "actions.addClient": "Add client",
    "actions.addTransaction": "Add transaction",
    "actions.createQuotation": "Create quotation",
  }) as Record<string, string>)[key] ?? key

describe("searchablePages", () => {
  it("includes business pages and excludes personal-only ones for a business org", () => {
    const hrefs = searchablePages("business", false).map((p) => p.href)
    expect(hrefs).toContain("/clients")
    expect(hrefs).toContain("/quotations")
    expect(hrefs).not.toContain("/spaces")
    expect(hrefs).not.toContain("/admin")
  })

  it("excludes business-only pages for a personal org and includes spaces", () => {
    const hrefs = searchablePages("personal", false).map((p) => p.href)
    expect(hrefs).not.toContain("/clients")
    expect(hrefs).not.toContain("/quotations")
    expect(hrefs).toContain("/spaces")
  })

  it("adds /admin only for admins and uses the provided members href", () => {
    const pages = searchablePages("business", true, "/organizations/abc/members")
    expect(pages.map((p) => p.href)).toContain("/admin")
    expect(pages.map((p) => p.href)).toContain("/organizations/abc/members")
  })

  it("every page has a labelKey and an icon", () => {
    for (const p of searchablePages("business", true)) {
      expect(p.labelKey).toMatch(/^nav\./)
      expect(p.icon).toBeTruthy()
    }
  })
})

describe("quickActions", () => {
  it("business orgs get all three ?new=1 actions", () => {
    const hrefs = quickActions("business").map((a) => a.href)
    expect(hrefs).toEqual(
      expect.arrayContaining(["/clients?new=1", "/transactions?new=1", "/quotations?new=1"]),
    )
  })

  it("personal orgs only get the transaction action", () => {
    const hrefs = quickActions("personal").map((a) => a.href)
    expect(hrefs).toEqual(["/transactions?new=1"])
  })
})

describe("filterLocal", () => {
  const items = searchablePages("business", false)

  it("empty query returns everything", () => {
    expect(filterLocal(items, "", t)).toHaveLength(items.length)
  })

  it("matches on the translated label, case-insensitively", () => {
    const hit = filterLocal(items, "DASH", t)
    expect(hit.map((p) => p.href)).toEqual(["/dashboard"])
  })

  it("returns [] when nothing matches", () => {
    expect(filterLocal(items, "zzzznope", t)).toEqual([])
  })
})
