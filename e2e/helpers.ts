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

export type E2eOrg = { id: string; is_personal: boolean; account_type?: string | null }

/**
 * Which workspace the e2e user is in, and putting it back afterwards.
 *
 * The active workspace is SHARED STATE on the server
 * (`user_profiles.current_organization_id`), not per-test state — and playwright
 * runs this suite with `workers: 1`, in file-name order. So a spec that switches
 * to the personal workspace and stops there changes what every LATER spec sees.
 *
 * That is not hypothetical. `recurring-debt` sorts before `smoke`, and leaving
 * the user personal turned off /clients and /quotations — they are business-only
 * (`accountTypeAllows`) — so smoke's "create a client" clicked a button that
 * wasn't there and waited out its timeout on a dialog that could never open.
 *
 * The rule every spec here follows: `rememberWorkspace` in `beforeAll`,
 * `switchWorkspace` for the work, `restoreWorkspace` in `afterAll`.
 */
export async function switchWorkspace(page: Page, api: E2eApi, want: "personal" | "business" | string): Promise<string> {
  const { json: orgs } = await api<E2eOrg[]>(page, "GET", "/api/organizations")
  const pick =
    want === "personal"
      ? orgs.find((o) => o.is_personal)
      : want === "business"
        ? orgs.find((o) => !o.is_personal)
        : orgs.find((o) => o.id === want)
  if (!pick) throw new Error(`e2e: no "${want}" workspace for this user (have: ${orgs.map((o) => o.id).join(", ")})`)
  const { status } = await api(page, "POST", "/api/organizations/switch", { organization_id: pick.id })
  if (status !== 200) throw new Error(`e2e: could not switch workspace (${status})`)
  // Pin the client-side mirror too: the saved storage state carries the business
  // org, and a tab that boots with the stale value keeps sending the old
  // `x-org-id` on every request.
  await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, pick.id)
  return pick.id
}

/**
 * The workspace to come back to. Reads the browser's mirror first — a context
 * built from the saved storage state carries the BUSINESS org that
 * `auth.setup.ts` pinned, which is the workspace the suite as a whole expects,
 * and it is immune to an upstream spec that already leaked. The profile is the
 * fallback for a page that was not started from that state.
 */
export async function rememberWorkspace(page: Page, api: E2eApi): Promise<string> {
  const mirrored = await page.evaluate(() => { try { return localStorage.getItem("ps_active_org") } catch { return null } }).catch(() => null)
  if (mirrored) return mirrored
  const { json } = await api<{ current_organization_id?: string | null }>(page, "GET", "/api/profile")
  return json?.current_organization_id ?? ""
}

/** Put it back. Never throws — a failing restore must not mask the real failure. */
export async function restoreWorkspace(page: Page, api: E2eApi, orgId: string): Promise<void> {
  if (!orgId) return
  await api(page, "POST", "/api/organizations/switch", { organization_id: orgId }).catch(() => {})
  await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, orgId).catch(() => {})
}
