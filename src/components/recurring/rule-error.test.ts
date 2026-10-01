import { afterEach, describe, expect, it } from "vitest"
import i18n, { setAppLanguage } from "@/lib/i18n"
import { ruleErrorText } from "./rule-error"

afterEach(async () => {
  await setAppLanguage("en")
})

describe("ruleErrorText (MC-077)", () => {
  it("shows a legacy English last_error as it is, and nothing for none", () => {
    expect(ruleErrorText("Card is frozen — unfreeze it or pick another card", "x")).toBe("Card is frozen — unfreeze it or pick another card")
    expect(ruleErrorText("", "x")).toBe("")
    expect(ruleErrorText(null, "x")).toBe("")
  })

  it("translates a coded body, filled from its params", async () => {
    const stored = JSON.stringify({ error: "This debt is in EUR — pay it from an account in EUR", code: "currency_mismatch", context: "debt", currency: "EUR" })
    await setAppLanguage("ml")
    const msg = ruleErrorText(stored, "fallback")
    expect(msg).toBe(i18n.t("apiErrors.currency_mismatch_debt", { currency: "EUR" }))
    expect(msg).not.toContain("pay it from")
  })

  it("never shows the stored JSON: English keeps the sentence of an unmapped code, others the fallback", async () => {
    const stored = JSON.stringify({ error: "Something specific", code: "no_such_code_here" })
    expect(ruleErrorText(stored, "fallback")).toBe("Something specific")
    await setAppLanguage("ar")
    expect(ruleErrorText(stored, "fallback")).toBe("fallback")
  })
})
