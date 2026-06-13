import { expect, test } from "@playwright/test"

/**
 * PRODUCTION-BUILD smoke — runs against `vite build` output served by
 * `vite preview` (see the prod-build project + second webServer in
 * playwright.config.ts). Signed out, no DB: the point is purely that the BUILT
 * artifact boots in a browser.
 *
 * Catches the class of failures the dev-server suite is structurally blind to:
 * chunk-graph cycles (the 2026-06-13 "forwardRef of undefined" white screen on
 * every page), broken module preloads, bad transforms — anything where the
 * bundle differs from dev. A page that renders nothing or throws on boot fails
 * here even though every dev-server test passes.
 */

// Console noise that is expected in a local preview and must not fail the gate.
const IGNORED_CONSOLE = [
  /_vercel\/insights/, // Vercel Analytics script is absent outside Vercel
  /Vercel Web Analytics/,
  /development keys/i, // Clerk dev-instance warning
  /beforeinstallpromptevent/i, // PWA install banner notice
  /Failed to load resource.*40[34]/, // favicon/analytics 404s in preview
]

function collectBootErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}

test.describe("production build boots", () => {
  test("login page renders from the built bundle without boot errors", async ({ page }) => {
    const errors = collectBootErrors(page)
    await page.goto("/login")
    // Clerk's sign-in form rendering proves React mounted and the eager chunk
    // graph (index + vendor + any preloaded leaves) initialized correctly.
    await expect(page.locator("input").first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator("#root > *").first()).toBeAttached()
    expect(errors, `boot errors on /login:\n${errors.join("\n")}`).toEqual([])
  })

  test("marketing landing renders from the built bundle without boot errors", async ({ page }) => {
    const errors = collectBootErrors(page)
    await page.goto("/")
    await expect(page.locator("#root > *").first()).toBeAttached({ timeout: 20_000 })
    await expect(page.getByRole("heading").first()).toBeVisible()
    expect(errors, `boot errors on /:\n${errors.join("\n")}`).toEqual([])
  })

  test("an app route serves the shell and mounts React (signed out → login redirect)", async ({ page }) => {
    const errors = collectBootErrors(page)
    await page.goto("/dashboard")
    // Signed out, AppLayout must redirect to /login — proving the router and
    // the full eager bundle executed, not just static HTML.
    await page.waitForURL(/\/login/, { timeout: 20_000 })
    await expect(page.locator("#root > *").first()).toBeAttached()
    expect(errors, `boot errors on /dashboard:\n${errors.join("\n")}`).toEqual([])
  })
})
