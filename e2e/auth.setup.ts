import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright"
import { createClerkClient } from "@clerk/backend"
import { expect, test as setup, type Page } from "@playwright/test"
import { E2E_EMAIL, E2E_PREFIX, expectAppShell } from "./helpers"

const AUTH_FILE = "e2e/.auth/user.json"
const E2E_PASSWORD = process.env.E2E_CLERK_PASSWORD || "e2e-Profitsync!2026-secret"

/**
 * Authenticates the e2e user WITHOUT driving Clerk's UI (bot protection blocks
 * automated signups by design — the official path is @clerk/testing):
 *   1. ensure the test user exists via the Backend API (CLERK_SECRET_KEY),
 *   2. mint a testing token (clerkSetup) so the browser bypasses bot checks,
 *   3. sign in programmatically (clerk.signIn) and persist storage state,
 *   4. click through first-run onboarding when it appears.
 */
setup("authenticate", async ({ page }) => {
  setup.setTimeout(150_000)

  // Bridge env naming: @clerk/testing expects CLERK_PUBLISHABLE_KEY.
  if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY
  }
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required for e2e (see .env.local / E2E_CLERK_SECRET_KEY secret)")
  }

  // 1. Ensure the test user exists (idempotent).
  const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const existing = await backend.users.getUserList({ emailAddress: [E2E_EMAIL] })
  if (existing.totalCount === 0) {
    await backend.users.createUser({
      emailAddress: [E2E_EMAIL],
      password: E2E_PASSWORD,
      firstName: "E2E",
      lastName: "Bot",
      skipPasswordChecks: true,
    })
  }

  // 2. Testing token (bypasses bot protection for this run).
  await clerkSetup()

  // 3. Programmatic sign-in. This instance requires password + an email_code
  //    SECOND factor — the fixed test code 424242 covers it for `+clerk_test`
  //    addresses, so we drive clerk-js directly (@clerk/testing's signIn helper
  //    doesn't handle 2FA).
  await setupClerkTestingToken({ page })
  await page.goto("/login")
  await page.waitForFunction(() => (window as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 })
  const signInResult = await page.evaluate(
    async ({ email, password, code }) => {
      type SignInResource = {
        status: string
        supportedSecondFactors?: { strategy: string; emailAddressId?: string }[]
        prepareSecondFactor: (p: Record<string, unknown>) => Promise<unknown>
        attemptSecondFactor: (p: Record<string, unknown>) => Promise<{ status: string; createdSessionId: string }>
        createdSessionId: string
      }
      const Clerk = (window as unknown as {
        Clerk: { client: { signIn: { create: (p: Record<string, unknown>) => Promise<SignInResource> } }; setActive: (p: Record<string, unknown>) => Promise<void> }
      }).Clerk
      try {
        const res = await Clerk.client.signIn.create({ identifier: email, password, strategy: "password" })
        if (res.status === "complete") {
          await Clerk.setActive({ session: res.createdSessionId })
          return { ok: true }
        }
        if (res.status === "needs_second_factor") {
          const factor = res.supportedSecondFactors?.find((f) => f.strategy === "email_code")
          if (!factor) return { ok: false, error: "no email_code second factor" }
          await res.prepareSecondFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId })
          const attempt = await res.attemptSecondFactor({ strategy: "email_code", code })
          if (attempt.status !== "complete") return { ok: false, error: `2fa status ${attempt.status}` }
          await Clerk.setActive({ session: attempt.createdSessionId })
          return { ok: true }
        }
        return { ok: false, error: `sign-in status ${res.status}` }
      } catch (e) {
        const err = e as { errors?: { message?: string }[] }
        return { ok: false, error: err.errors?.[0]?.message ?? String(e) }
      }
    },
    { email: E2E_EMAIL, password: E2E_PASSWORD, code: "424242" },
  )
  expect(signInResult.ok, signInResult.error ?? "sign-in failed").toBe(true)
  await page.goto("/dashboard")

  // 4. Complete first-run onboarding through the SAME API the wizard calls
  //    (deterministic — the multi-step UI is Clerk-independent product surface
  //    covered elsewhere). Business type unlocks clients/quotations.
  const businessOrgId = await completeOnboardingViaApi(page)

  // 4b. Sweep leftovers from prior FAILED runs. When any smoke test fails, the
  //     serial group aborts and the trailing cleanup test never runs — so e2e
  //     clients/transactions accumulate in the e2e database until the free-plan
  //     quotas (10 clients, 30 tx/client) start 403ing the create flows (the
  //     add-transaction dialog then closes and routes to /subscription, which
  //     reads as "the new row never appeared"). Sweeping up front makes every
  //     run self-healing. Done through the app's own API (soft delete → trash
  //     clear) so wealth balances are reversed correctly.
  await sweepLeftoverE2eData(page, businessOrgId)

  // 5. Pin the BUSINESS workspace as the browser's active org BEFORE saving
  //    storage state. OrgProvider switches to it on the next boot anyway
  //    (`profile.current_organization_id`), but `expectAppShell` resolves on the
  //    sidebar link — which renders BEFORE that async switch completes — so
  //    without this the saved state can pin the auto-created PERSONAL org, and
  //    every test then runs in a personal workspace where the add-transaction
  //    dialog has no client picker (the transaction test then can't select the
  //    e2e client). `ps_active_org` is the localStorage key `setActiveOrgId` uses.
  await page.evaluate((id) => localStorage.setItem("ps_active_org", id), businessOrgId)
  await page.goto("/dashboard")
  await page.waitForFunction((id) => localStorage.getItem("ps_active_org") === id, businessOrgId, { timeout: 20_000 })
  await expectAppShell(page)
  await page.context().storageState({ path: AUTH_FILE })
})

async function sweepLeftoverE2eData(page: Page, orgId: string) {
  const result = await page.evaluate(
    async ({ orgId, prefix }) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
      if (!token) return { ok: false, error: "no session token", deleted: 0 }
      const headers = { Authorization: `Bearer ${token}`, "x-org-id": orgId }
      const listRes = await fetch(`/api/clients?search=${encodeURIComponent(prefix)}`, { headers })
      if (!listRes.ok) return { ok: false, error: `client list ${listRes.status}`, deleted: 0 }
      const body = (await listRes.json()) as { id: string; name: string }[] | { data: { id: string; name: string }[] }
      const rows = Array.isArray(body) ? body : body.data
      const targets = rows.filter((c) => c.name.startsWith(prefix))
      let deleted = 0
      for (const c of targets) {
        const del = await fetch(`/api/clients/${c.id}`, { method: "DELETE", headers })
        if (!del.ok) return { ok: false, error: `delete ${c.id} → ${del.status}`, deleted }
        deleted++
      }
      // Purge the org's whole trash — the purge (not the soft delete) is what
      // reverses wealth balances, and this org exists solely for the e2e suite.
      const clear = await fetch("/api/trash/clear", { method: "POST", headers })
      if (!clear.ok) return { ok: false, error: `trash clear → ${clear.status}`, deleted }
      return { ok: true, error: "", deleted }
    },
    { orgId, prefix: E2E_PREFIX },
  )
  expect(result.ok, `e2e leftover sweep failed: ${result.error}`).toBe(true)
  if (result.deleted > 0) console.log(`[e2e setup] swept ${result.deleted} leftover ${E2E_PREFIX} client(s) from a prior run`)
}

async function completeOnboardingViaApi(page: Page) {
  // The app boots lazily — wait for clerk-js + an active session first.
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk
      return !!c?.loaded && !!c.session
    },
    null,
    { timeout: 30_000 },
  )
  const result = await page.evaluate(async () => {
    const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
    const token = await Clerk.session?.getToken()
    if (!token) return { ok: false, error: "no session token" }
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ account_type: "business", company_name: "E2E Test Co", currency: "USD" }),
    })
    if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` }
    const body = (await res.json()) as { organization_id?: string }
    return { ok: true, organizationId: body.organization_id }
  })
  expect(result.ok, result.error ?? "onboarding failed").toBe(true)
  expect(result.organizationId, "onboarding did not return organization_id").toBeTruthy()
  return result.organizationId as string
}
