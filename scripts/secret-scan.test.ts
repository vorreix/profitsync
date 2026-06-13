// Locks the secret-scanner patterns: real-looking credentials match,
// documentation placeholders never do (false positives erode trust in the gate).
import { describe, expect, it } from "vitest"
// @ts-expect-error — plain .mjs module (the pre-commit CLI); vitest resolves it fine.
import { matchSecret } from "./secret-scan.mjs"

describe("matchSecret — real credentials are caught", () => {
  const REAL = [
    "const k = 'sk_live_abcDEF123456789012345'", // secret-scan:ignore
    "CLERK_SECRET_KEY=sk_test_ZZZZyyyyXXXX12345678", // secret-scan:ignore
    "DODO_PAYMENTS_WEBHOOK_SECRET=whsec_AbCdEf1234567890AbCdEf12", // secret-scan:ignore
    "postgresql://app_user:supersecretpw@ep-host.neon.tech/db", // secret-scan:ignore
    "-----BEGIN RSA PRIVATE KEY-----", // secret-scan:ignore
    "aws_key = AKIAIOSFODNN7EXAMPLE", // secret-scan:ignore
    "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789", // secret-scan:ignore
  ]
  for (const line of REAL) {
    it(`flags: ${line.slice(0, 40)}…`, () => {
      // Strip the ignore marker used to keep THIS test file commitable.
      expect(matchSecret(line.replace(/\s*\/\/ secret-scan:ignore$/, ""))).not.toBeNull()
    })
  }
})

describe("matchSecret — placeholders stay quiet", () => {
  const SAFE = [
    "CLERK_SECRET_KEY=sk_test_...",
    "DODO_PAYMENTS_WEBHOOK_SECRET=whsec_...",
    "DATABASE_URL=postgresql://<user>:<password>@<host>.neon.tech/<db>",
    "DATABASE_URL=postgresql://...",
    "see https://example.com/docs",
    "const sk = skipPasswordChecks",
    "// sk_live_ keys must never be committed",
  ]
  for (const line of SAFE) {
    it(`ignores: ${line.slice(0, 48)}`, () => {
      expect(matchSecret(line)).toBeNull()
    })
  }

  it("honors the explicit ignore marker", () => {
    expect(matchSecret("example: sk_live_abcDEF123456789012345 // secret-scan:ignore")).toBeNull()
  })
})
