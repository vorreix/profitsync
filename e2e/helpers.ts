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
