import { expect, type Page } from "@playwright/test"

/** Everything the suite creates is namespaced so cleanup is unambiguous. */
export const E2E_PREFIX = "e2e-ux4"

export const E2E_EMAIL = process.env.E2E_CLERK_EMAIL || "e2e+clerk_test@profitsync.dev"

/** Clerk's fixed verification code for `+clerk_test` addresses. */
export const CLERK_TEST_CODE = "424242"

/** Wait for the app shell (sidebar or mobile tab bar) — i.e. signed in + booted. */
export async function expectAppShell(page: Page): Promise<void> {
  await expect(page.getByRole("link", { name: /dashboard|home/i }).first()).toBeVisible({ timeout: 20_000 })
}

/** Dismiss the referral banner if it's covering the header (best-effort). */
export async function dismissBanners(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: /dismiss/i }).first()
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {})
}

/** The shape every spec's local `api()` has, so shared helpers can borrow one. */
export type E2eApi = <T>(page: Page, method: string, path: string, body?: unknown) => Promise<{ status: number; json: T }>

export type E2eAccount = { id: string; type: string; bank_name: string; nickname: string; archived_at: string | null }

/**
 * The bank account the card specs hang their cards off, created when missing.
 *
 * THREE SPECS ASSERTED THIS BANK EXISTED AND NONE OF THEM MADE ONE. They passed
 * only because some earlier run had left one behind in the shared e2e database,
 * so the suite was quietly depending on dirt. The first time it met a clean
 * database — when the e2e branch was rebuilt to repair its migration history —
 * all three failed on "an active bank account to hang debit cards on".
 *
 * Deliberately NOT namespaced with `E2E_PREFIX`: every spec's cleanup deletes
 * prefixed accounts, so a prefixed bank would be torn down and rebuilt between
 * specs, and a free-plan workspace is gated to one bank. One unprefixed row,
 * created at most once, is both cheaper and closer to what a real workspace
 * looks like.
 */
export async function ensureBank(page: Page, api: E2eApi): Promise<E2eAccount> {
  const activeBank = async () => {
    const { json } = await api<E2eAccount[]>(page, "GET", "/api/wealth/accounts")
    return (json ?? []).find((a) => a.type === "bank" && !a.archived_at)
  }

  const existing = await activeBank()
  if (existing) return existing

  const { status, json } = await api<unknown>(page, "POST", "/api/wealth/accounts", {
    type: "bank",
    bank_name: "E2E Bank",
    nickname: "E2E Bank",
    opening_balance: "5000.00",
  })
  if (status !== 200 && status !== 201) {
    throw new Error(`e2e: could not create the bank account (${status}): ${JSON.stringify(json)}`)
  }

  const made = await activeBank()
  if (!made) throw new Error("e2e: created a bank account but it did not come back active")
  return made
}
