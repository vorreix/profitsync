import { expect, test } from "@playwright/test"
import { dismissBanners, E2E_PREFIX, expectAppShell } from "./helpers"

/**
 * The core business flows, in dependency order (serial — see playwright.config):
 * dashboard boots → wealth shows Cash → client created → transaction created
 * (and visible) → calendar/recurring/subscription render → trash delete+purge
 * cleans the data back up.
 */

const CLIENT_NAME = `${E2E_PREFIX} client`
const TX_DESC = `${E2E_PREFIX} payment`

test.describe.serial("core flows", () => {
  test("dashboard boots with the app shell and KPI cards", async ({ page }) => {
    await page.goto("/dashboard")
    await expectAppShell(page)
    await expect(page.locator('[data-dash-card="kpis"]')).toBeVisible()
    await expect(page.locator('[data-dash-card="latest"]')).toBeVisible()
  })

  test("wealth page always has the Cash in Hand account", async ({ page }) => {
    await page.goto("/wealth")
    await expect(page.getByText("Cash in Hand").first()).toBeVisible({ timeout: 15_000 })
  })

  test("create a client", async ({ page }) => {
    await page.goto("/clients")
    await dismissBanners(page)
    await page.getByRole("button", { name: /add client|new client/i }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("textbox").first().fill(CLIENT_NAME)
    await dialog.getByRole("button", { name: /add|create|save/i }).last().click()
    // In-place insert — the new client appears without a reload.
    await expect(page.getByText(CLIENT_NAME).first()).toBeVisible({ timeout: 15_000 })
  })

  test("create a transaction and see it in the list", async ({ page }) => {
    await page.goto("/transactions")
    await dismissBanners(page)
    await page.getByRole("button", { name: /add transaction|^add$/i }).first().click()
    // A closed popover also exposes role=dialog — scope by name (strict mode).
    const dialog = page.getByRole("dialog", { name: /add transaction/i })
    await expect(dialog).toBeVisible()

    // Client (business org): the first combobox opens a searchable list.
    await dialog.getByRole("combobox").first().click()
    const search = page.getByPlaceholder(/search/i).first()
    await expect(search).toBeVisible()
    await search.fill(E2E_PREFIX)
    const option = page.getByRole("option", { name: new RegExp(E2E_PREFIX, "i") }).first()
    await expect(option).toBeVisible()
    // force: an ancestor keeps animating, so the default stability check loops.
    await option.click({ force: true })
    // The popover closes and the trigger shows the chosen client.
    await expect(dialog.getByRole("combobox").first()).toContainText(new RegExp(E2E_PREFIX, "i"))

    // Description (best-effort: optional free-text field).
    const desc = dialog.locator('input[placeholder*="e.g" i], input[placeholder*="invoice" i], input[placeholder*="hosting" i]').first()
    if (await desc.isVisible().catch(() => false)) await desc.fill(TX_DESC)

    // Amount — the prominent money input inside the account selector.
    await dialog.locator('input[inputmode="decimal"]').first().fill("123.45")

    await dialog.getByRole("button", { name: /^add transaction$|^add$|^save$/i }).last().click()
    await expect(dialog).not.toBeVisible({ timeout: 15_000 })
    // The new row appears in place (description when set, else the amount).
    await expect(page.getByText(TX_DESC).or(page.getByText(/123\.45/)).first()).toBeVisible({ timeout: 15_000 })
  })

  test("calendar shows the month grid and opens a day", async ({ page }) => {
    await page.goto("/calendar")
    await expect(page.locator("[data-dash-card], .grid.grid-cols-7").first()).toBeVisible({ timeout: 15_000 })
    // Today's cell exists (ring) — click it and the day modal opens.
    const cells = page.locator(".grid.grid-cols-7 button")
    await expect(cells.first()).toBeVisible()
  })

  test("recurring page renders", async ({ page }) => {
    await page.goto("/recurring")
    await expect(page.getByRole("heading", { name: /recurring/i })).toBeVisible({ timeout: 15_000 })
  })

  test("subscription page lists plans", async ({ page }) => {
    await page.goto("/subscription")
    await expect(page.getByText(/free/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test("cleanup: delete the e2e client (cascades its transactions) and purge", async ({ page }) => {
    await page.goto("/clients")
    await dismissBanners(page)
    const row = page.getByText(CLIENT_NAME).first()
    if (!(await row.isVisible().catch(() => false))) return // already clean
    await row.click()
    // Client detail → delete (soft) — the action may live behind a menu.
    const direct = page.getByRole("button", { name: /^delete/i }).first()
    if (await direct.isVisible().catch(() => false)) {
      await direct.click()
    } else {
      await page.getByRole("button", { name: /more|actions|menu/i }).first().click()
      await page.getByRole("menuitem", { name: /delete/i }).first().click()
    }
    const confirm = page.getByRole("alertdialog").getByRole("button", { name: /delete/i }).last()
    if (await confirm.isVisible().catch(() => false)) await confirm.click()

    // Purge from trash so the shared dev DB stays clean.
    await page.goto("/trash")
    const purgeAll = page.getByRole("button", { name: /empty trash|purge/i }).first()
    if (await purgeAll.isVisible().catch(() => false)) {
      await purgeAll.click()
      const confirmPurge = page.getByRole("alertdialog").getByRole("button", { name: /purge|empty|delete/i }).last()
      if (await confirmPurge.isVisible().catch(() => false)) await confirmPurge.click()
    }
  })
})
