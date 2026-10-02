import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import i18n, { setAppLanguage } from "@/lib/i18n"
import { apiErrorCode, apiErrorKey, translateApiError } from "./api-error-codes"

const thrown = (body: unknown) => new Error(typeof body === "string" ? body : JSON.stringify(body))

afterEach(async () => {
  await setAppLanguage("en")
})

describe("translateApiError (MC-063)", () => {
  it("translates a known code, filled from the body's params", async () => {
    await setAppLanguage("de")
    const msg = translateApiError(thrown({ error: "This budget is kept in EUR; enter the amount in EUR", code: "currency_mismatch", currency: "EUR" }), "fallback")
    expect(msg).toBe(i18n.t("apiErrors.currency_mismatch_in", { currency: "EUR" }))
    expect(msg).toContain("EUR")
    expect(msg).not.toContain("enter the amount")
  })

  it("names the account-currency lock reason, and a card's lock without one", () => {
    expect(translateApiError(thrown({ code: "account_currency_locked", reason: "transfer", currency: "EUR" }), "x")).toBe(i18n.t("wealth.accountCurrencyLockedTransfer"))
    expect(translateApiError(thrown({ code: "account_currency_locked", reason: "balance", currency: "EUR" }), "x")).toContain("EUR")
    expect(translateApiError(thrown({ code: "account_currency_locked" }), "x")).toBe(i18n.t("wealth.cardWizard.errors.account_currency_locked"))
  })

  it("resolves plural and nested-param keys", () => {
    expect(translateApiError(thrown({ code: "invalid_code", attempts_left: 2 }), "x")).toBe(i18n.t("deleteAccount.invalidCode", { count: 2 }))
    expect(translateApiError(thrown({ error: "category_claimed", detail: { by: "Food", categories: ["Groceries", "Dining"] } }), "x"))
      .toBe(i18n.t("budgets.errors.categoryClaimed", { categories: "Groceries, Dining", name: "Food" }))
  })

  it("never prints a {{placeholder}} the body didn't fill", async () => {
    // A legacy account has no currency; its history line names one.
    const legacy = thrown({ code: "account_currency_locked", reason: "history", currency: null })
    expect(translateApiError(legacy, "x")).toBe(i18n.t("apiErrors.account_currency_locked"))
    // A reason whose line names no currency keeps its own line.
    expect(translateApiError(thrown({ code: "account_currency_locked", reason: "recurring", currency: null }), "x")).toBe(i18n.t("wealth.accountCurrencyLockedRecurring"))
    await setAppLanguage("ml")
    expect(translateApiError(legacy, "x")).not.toContain("{{")
  })

  it("reads a rename clash at the top level, and names an unnamed overall budget", () => {
    expect(translateApiError(thrown({ error: "category_claimed", a: "Food", b: "Treats", categories: ["Snacks"] }), "x"))
      .toBe(i18n.t("budgets.errors.renameClash", { categories: "Snacks", a: "Food", b: "Treats" }))
    expect(translateApiError(thrown({ error: "overall_exists", detail: { by: null } }), "x"))
      .toBe(i18n.t("budgets.errors.overallExists", { name: i18n.t("budgets.overall") }))
  })

  it("keeps the specific English sentence when the code covers several meanings", async () => {
    const debt = thrown({ error: "A repayment for a EUR debt must come from a EUR account", code: "currency_mismatch" })
    expect(translateApiError(debt, "x")).toBe("A repayment for a EUR debt must come from a EUR account")
    expect(translateApiError(thrown({ error: "Minimum payout is 50 USD", code: "below_min_payout" }), "x")).toBe("Minimum payout is 50 USD")
    // …and names the debt's currency once the body carries it.
    expect(translateApiError(thrown({ error: "…", code: "currency_mismatch", context: "debt", currency: "EUR" }), "x"))
      .toBe(i18n.t("apiErrors.currency_mismatch_debt", { currency: "EUR" }))
    await setAppLanguage("de")
    expect(translateApiError(debt, "x")).toBe(i18n.t("apiErrors.currency_mismatch"))
  })

  it("never shows raw JSON, a bare code token, or a network error", () => {
    expect(translateApiError(thrown("Failed to fetch"), "fallback")).toBe("fallback")
    expect(translateApiError(thrown("auth"), "fallback")).toBe("fallback")
    expect(translateApiError(thrown({ error: "some_unknown_token" }), "fallback")).toBe("fallback")
    expect(translateApiError("not an error", "fallback")).toBe("fallback")
  })

  it("keeps an unmapped server sentence for English readers only", async () => {
    const err = thrown({ error: "Something specific went wrong" })
    expect(translateApiError(err, "fallback")).toBe("Something specific went wrong")
    await setAppLanguage("ar")
    expect(translateApiError(err, "fallback")).toBe("fallback")
  })

  it("keeps a plan limit's own sentence in English and translates it otherwise", async () => {
    const err = thrown({ allowed: false, reason: "Free plan is limited to 10 clients. Upgrade to Premium to add more.", limit: 10, upgradeHint: true })
    expect(translateApiError(err, "x")).toContain("10 clients")
    await setAppLanguage("it")
    expect(translateApiError(err, "x")).toBe(i18n.t("apiErrors.plan_limit_upgrade"))
  })

  it("reads the code from `code`, or from a bare token sent as `error`", () => {
    expect(apiErrorCode(thrown({ error: "x y", code: "transfer_trashed" }))).toBe("transfer_trashed")
    expect(apiErrorCode(thrown({ error: "name_taken" }))).toBe("name_taken")
    expect(apiErrorCode(thrown({ error: "Readable sentence" }))).toBeNull()
    expect(apiErrorCode(thrown("plain"))).toBeNull()
  })
})

// ── Every code the API can send has a translation ───────────────────────────
//
// Scans the server for the codes it emits, the same way a reviewer would grep,
// so a new refusal without a translation fails here instead of reaching a
// German user as an English toast.

const ROOT = join(__dirname, "..", "..")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

function emittedCodes(): Set<string> {
  const codes = new Set<string>()
  const add = (text: string, re: RegExp) => {
    for (const m of text.matchAll(re)) codes.add(m[1])
  }
  for (const file of sources(join(ROOT, "api"))) {
    const text = readFileSync(file, "utf8")
    add(text, /\bcode:\s*"([a-z][a-z0-9_]*)"/g)
    // Handlers that send the code itself as `error` ("name_taken").
    add(text, /\berror:\s*"([a-z][a-z0-9_]*)"/g)
  }
  // Codes chosen at runtime: the ledger functions' RAISE tokens, the typed
  // amount refusals, the debt-link refusals and the card onboarding problems.
  for (const file of readdirSync(join(ROOT, "drizzle")).filter((f) => f.endsWith(".sql"))) {
    add(readFileSync(join(ROOT, "drizzle", file), "utf8"), /RAISE EXCEPTION '([a-z][a-z0-9_]*)' USING ERRCODE = 'P0001'/g)
  }
  add(readFileSync(join(ROOT, "src/lib/money.ts"), "utf8"), /new AmountError\("([a-z_]+)"/g)
  const debtRecurring = readFileSync(join(ROOT, "src/lib/debt-recurring.ts"), "utf8")
  const union = debtRecurring.slice(debtRecurring.indexOf("export type LinkRefusal"), debtRecurring.indexOf("export type LinkCandidateRule"))
  add(union, /\|\s*"([a-z_]+)"/g)
  const creditCard = readFileSync(join(ROOT, "src/lib/credit-card.ts"), "utf8")
  const onboarding = creditCard.slice(creditCard.indexOf("export function validateCardOnboarding"))
  add(onboarding.slice(0, onboarding.indexOf("\n}\n")), /return "([a-z_]+)"/g)
  return codes
}

// Not refusals: language codes in a locale list, and the mailer's internal
// result (api/_lib/email.ts), which no route sends to a client.
const NOT_REFUSALS = new Set(["en", "de", "it", "hi", "ml", "ta", "te", "ar", "email_not_configured"])

describe("every refusal code the API sends is translated", () => {
  const codes = [...emittedCodes()].filter((c) => !NOT_REFUSALS.has(c)).sort()

  it("finds the codes it is meant to guard", () => {
    // A broken scan would pass vacuously.
    for (const c of ["transfer_trashed", "account_currency_locked", "amount_too_many_decimals", "reversal_linked_transfer_is_immutable", "repayment_exists", "same_day", "name_taken"]) {
      expect(codes).toContain(c)
    }
  })

  it.each(codes)("%s", (code) => {
    expect(apiErrorKey({ code, error: code }), `no translation for "${code}" — add apiErrors.${code} to every locale`).not.toBeNull()
  })
})
