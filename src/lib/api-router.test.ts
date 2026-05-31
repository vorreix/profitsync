import { describe, it, expect } from "vitest"
import { matchRoute, type RoutePattern } from "./api-router"

const routes: RoutePattern<string>[] = [
  { segments: ["profile"], handler: "profile" },
  { segments: ["clients"], handler: "clients" },
  { segments: ["clients", ":id"], handler: "clientById" },
  { segments: ["organizations", "switch"], handler: "orgSwitch" },
  { segments: ["organizations", ":id"], handler: "orgById" },
  { segments: ["organizations", ":id", "members"], handler: "orgMembers" },
  { segments: ["transactions", ":id", "attachments"], handler: "txAttachments" },
]

describe("matchRoute", () => {
  it("matches a static single-segment route", () => {
    expect(matchRoute(routes, ["profile"])?.handler).toBe("profile")
  })

  it("captures a dynamic segment into params", () => {
    const m = matchRoute(routes, ["clients", "abc-123"])
    expect(m?.handler).toBe("clientById")
    expect(m?.params).toEqual({ id: "abc-123" })
  })

  it("prefers a static segment over a dynamic sibling (order matters)", () => {
    expect(matchRoute(routes, ["organizations", "switch"])?.handler).toBe("orgSwitch")
    const dyn = matchRoute(routes, ["organizations", "org-9"])
    expect(dyn?.handler).toBe("orgById")
    expect(dyn?.params).toEqual({ id: "org-9" })
  })

  it("matches nested dynamic routes and captures the param", () => {
    const m = matchRoute(routes, ["transactions", "t1", "attachments"])
    expect(m?.handler).toBe("txAttachments")
    expect(m?.params).toEqual({ id: "t1" })
  })

  it("returns null for unknown paths or wrong segment counts", () => {
    expect(matchRoute(routes, ["nope"])).toBeNull()
    expect(matchRoute(routes, ["clients", "1", "extra"])).toBeNull()
    expect(matchRoute(routes, [])).toBeNull()
  })
})
