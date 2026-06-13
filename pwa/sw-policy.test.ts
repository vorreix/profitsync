import { describe, expect, it } from "vitest"

import { matchAppNavigation, NAVIGATION_DENY_RE } from "./sw-policy"

function navCtx(pathname: string, mode: RequestMode = "navigate") {
  return {
    request: { mode } as Request,
    url: new URL(pathname, "https://profitsync.net"),
  }
}

describe("matchAppNavigation", () => {
  it("inlines the exact NAVIGATION_DENY_RE (workbox serializes the function source — a drift here ships a wrong service worker)", () => {
    expect(matchAppNavigation.toString()).toContain(NAVIGATION_DENY_RE.source)
  })

  it("hands app-route navigations to the service worker", () => {
    for (const path of [
      "/dashboard",
      "/clients",
      "/clients/42",
      "/transactions",
      "/wealth/7",
      "/login",
      "/admin",
      "/admin/users",
      "/subscription",
      "/blogging-tools", // not /blog — only the exact public blog prefix is denied
    ]) {
      expect(matchAppNavigation(navCtx(path)), path).toBe(true)
    }
  })

  it("leaves public/marketing/API navigations entirely to the network", () => {
    for (const path of [
      "/",
      "/privacy-policy",
      "/terms-of-service",
      "/refund-policy",
      "/blog",
      "/blog/some-post",
      "/invitations/abc123",
      "/api/profile",
      "/@vite/client",
    ]) {
      expect(matchAppNavigation(navCtx(path)), path).toBe(false)
    }
  })

  it("ignores non-navigation requests", () => {
    expect(matchAppNavigation(navCtx("/dashboard", "cors"))).toBe(false)
    expect(matchAppNavigation(navCtx("/assets/index-abc.js", "no-cors"))).toBe(false)
  })
})
