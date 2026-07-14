import { describe, it, expect } from "vitest"
import { nextClientJwt } from "./native-clerk-transport"

// Locks the native client-token rotation rule that governs cold-start session
// persistence. The historical bug: an empty ("") Authorization response header
// was treated as a sign-out and wiped the stored token, so the app booted
// signed-out on the next cold start.
describe("nextClientJwt — native client-token rotation", () => {
  it("adopts a freshly rotated, non-empty token", () => {
    expect(nextClientJwt("old-token", "new-token")).toBe("new-token")
    expect(nextClientJwt(null, "first-token")).toBe("first-token")
  })

  it("keeps the held token when the response carries NO Authorization header (null)", () => {
    // Absent header = this response did not rotate the client token.
    expect(nextClientJwt("held-token", null)).toBe("held-token")
    expect(nextClientJwt(null, null)).toBeNull()
  })

  it("keeps the held token on an EMPTY Authorization header (the cold-start-logout guard)", () => {
    // The regression this file exists for: "" must NOT wipe a live token.
    expect(nextClientJwt("live-token", "")).toBe("live-token")
    expect(nextClientJwt(null, "")).toBeNull()
  })

  it("never persists an empty string as the token", () => {
    // Whatever comes back, we never end up holding "" as a bearer.
    expect(nextClientJwt("live-token", "")).not.toBe("")
    expect(nextClientJwt(null, "")).not.toBe("")
  })
})
