import { describe, it, expect } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
  it("joins multiple class names", () => {
    expect(cn("a", "b")).toBe("a b")
  })

  it("drops falsey values", () => {
    expect(cn("a", false, undefined, null, "c")).toBe("a c")
  })

  it("merges conflicting Tailwind classes so the last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active")
  })
})
