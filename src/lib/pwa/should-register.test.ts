import { describe, it, expect } from "vitest"

import { shouldRegisterHere } from "./should-register"

describe("shouldRegisterHere", () => {
  it("excludes the landing page", () => {
    expect(shouldRegisterHere("/")).toBe(false)
  })

  it("excludes legal and invitation routes", () => {
    expect(shouldRegisterHere("/privacy-policy")).toBe(false)
    expect(shouldRegisterHere("/terms-of-service")).toBe(false)
    expect(shouldRegisterHere("/invitations/abc123")).toBe(false)
  })

  it("includes auth and app routes", () => {
    expect(shouldRegisterHere("/login")).toBe(true)
    expect(shouldRegisterHere("/signup")).toBe(true)
    expect(shouldRegisterHere("/onboarding")).toBe(true)
    expect(shouldRegisterHere("/dashboard")).toBe(true)
    expect(shouldRegisterHere("/clients/42")).toBe(true)
    expect(shouldRegisterHere("/admin/users")).toBe(true)
  })
})
