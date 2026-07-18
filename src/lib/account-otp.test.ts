import { describe, expect, it } from "vitest"
import {
  DELETION_CODE_MAX_ATTEMPTS,
  DELETION_CODE_TTL_MS,
  generateDeletionCode,
  hashDeletionCode,
  maskEmail,
  resendWaitSeconds,
  verifyDeletionCode,
} from "./account-otp"

const now = new Date("2026-07-18T12:00:00Z")
const row = (over: Partial<{ codeHash: string; expiresAt: Date; attempts: number }> = {}) => ({
  codeHash: hashDeletionCode("user_1", "123456"),
  expiresAt: new Date(now.getTime() + DELETION_CODE_TTL_MS),
  attempts: 0,
  ...over,
})

describe("generateDeletionCode", () => {
  it("is always 6 digits (zero-padded)", () => {
    for (let i = 0; i < 200; i++) expect(generateDeletionCode()).toMatch(/^\d{6}$/)
  })
})

describe("hashDeletionCode", () => {
  it("is deterministic and bound to the user id", () => {
    expect(hashDeletionCode("user_1", "123456")).toBe(hashDeletionCode("user_1", "123456"))
    expect(hashDeletionCode("user_1", "123456")).not.toBe(hashDeletionCode("user_2", "123456"))
    expect(hashDeletionCode("user_1", "123456")).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("verifyDeletionCode", () => {
  it("accepts the right code", () => {
    expect(verifyDeletionCode(row(), "user_1", "123456", now)).toBe("valid")
  })
  it("rejects a wrong code", () => {
    expect(verifyDeletionCode(row(), "user_1", "654321", now)).toBe("mismatch")
  })
  it("rejects the right code for the wrong user", () => {
    expect(verifyDeletionCode(row(), "user_2", "123456", now)).toBe("mismatch")
  })
  it("rejects an expired code", () => {
    expect(verifyDeletionCode(row({ expiresAt: new Date(now.getTime() - 1) }), "user_1", "123456", now)).toBe("expired")
  })
  it("locks after max attempts (even with the right code)", () => {
    expect(verifyDeletionCode(row({ attempts: DELETION_CODE_MAX_ATTEMPTS }), "user_1", "123456", now)).toBe(
      "too_many_attempts",
    )
  })
})

describe("resendWaitSeconds", () => {
  it("is 0 after the cooldown and counts down inside it", () => {
    expect(resendWaitSeconds(new Date(now.getTime() - 60_000), now)).toBe(0)
    expect(resendWaitSeconds(new Date(now.getTime() - 45_000), now)).toBe(15)
    expect(resendWaitSeconds(now, now)).toBe(60)
  })
})

describe("maskEmail", () => {
  it("keeps a short prefix and the domain", () => {
    expect(maskEmail("john.doe@gmail.com")).toBe("jo•••@gmail.com")
    expect(maskEmail("a@b.co")).toBe("a•••@b.co")
    expect(maskEmail("not-an-email")).toBe("not-an-email")
  })
})
