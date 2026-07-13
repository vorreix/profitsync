import { describe, expect, it } from "vitest"
import {
  buildNativeOAuthBody,
  extractFapiError,
  extractVerificationUrl,
  fapiBaseFromPublishableKey,
} from "./native-oauth"
import { NATIVE_OAUTH_REDIRECT_URL } from "./native-auth"

describe("fapiBaseFromPublishableKey", () => {
  it("decodes a production key to the instance FAPI origin", () => {
    // btoa("clerk.profitsync.net$")
    expect(fapiBaseFromPublishableKey("pk_live_Y2xlcmsucHJvZml0c3luYy5uZXQk")).toBe(
      "https://clerk.profitsync.net",
    )
  })

  it("decodes a dev key to the accounts.dev FAPI origin", () => {
    // btoa("warm-oyster-76.clerk.accounts.dev$")
    expect(fapiBaseFromPublishableKey("pk_test_d2FybS1veXN0ZXItNzYuY2xlcmsuYWNjb3VudHMuZGV2JA")).toBe(
      "https://warm-oyster-76.clerk.accounts.dev",
    )
  })

  it("rejects malformed keys instead of producing a bogus origin", () => {
    expect(fapiBaseFromPublishableKey("")).toBeNull()
    expect(fapiBaseFromPublishableKey("pk_live_")).toBeNull()
    expect(fapiBaseFromPublishableKey("not-a-key")).toBeNull()
    // base64 of a string with characters illegal in a hostname
    expect(fapiBaseFromPublishableKey(`pk_live_${btoa("<script>$")}`)).toBeNull()
  })
})

describe("buildNativeOAuthBody", () => {
  it("sign-in: pins BOTH redirect urls to the allowlisted custom scheme", () => {
    const body = buildNativeOAuthBody("sign-in", "oauth_google")
    expect(body.get("strategy")).toBe("oauth_google")
    expect(body.get("redirect_url")).toBe(NATIVE_OAUTH_REDIRECT_URL)
    // A relative action_complete_redirect_url is rejected by native validation
    // ("Redirect url mismatch") — it must be the allowlisted scheme too.
    expect(body.get("action_complete_redirect_url")).toBe(NATIVE_OAUTH_REDIRECT_URL)
    expect(body.get("legal_accepted")).toBeNull()
    expect(body.get("unsafe_metadata")).toBeNull()
  })

  it("sign-up: adds legal acceptance and JSON-encoded unsafe metadata", () => {
    const body = buildNativeOAuthBody("sign-up", "oauth_apple", { referralCode: "r1" })
    expect(body.get("strategy")).toBe("oauth_apple")
    expect(body.get("legal_accepted")).toBe("true")
    expect(JSON.parse(body.get("unsafe_metadata") ?? "{}")).toEqual({ referralCode: "r1" })
  })
})

describe("extractVerificationUrl", () => {
  it("reads the sign-in shape (first_factor_verification)", () => {
    expect(
      extractVerificationUrl("sign-in", {
        response: { first_factor_verification: { external_verification_redirect_url: "https://x" } },
      }),
    ).toBe("https://x")
  })

  it("reads the sign-up shape (verifications.external_account)", () => {
    expect(
      extractVerificationUrl("sign-up", {
        response: { verifications: { external_account: { external_verification_redirect_url: "https://y" } } },
      }),
    ).toBe("https://y")
  })

  it("returns null when the url is absent", () => {
    expect(extractVerificationUrl("sign-in", { response: {} })).toBeNull()
    expect(extractVerificationUrl("sign-up", {})).toBeNull()
  })
})

describe("extractFapiError", () => {
  it("prefers the long message, then message, then the fallback", () => {
    expect(extractFapiError({ errors: [{ long_message: "L", message: "m" }] }, "f")).toBe("L")
    expect(extractFapiError({ errors: [{ message: "m" }] }, "f")).toBe("m")
    expect(extractFapiError({}, "f")).toBe("f")
  })
})
