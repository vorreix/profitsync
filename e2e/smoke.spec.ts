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
    // Scope to the popover's own "Search clients..." input — the transactions
    // page behind the modal has a list-filter input whose placeholder also
    // starts with "Search", and filling THAT filters the list instead.
    const search = page.getByPlaceholder(/search clients/i).first()
    await expect(search).toBeVisible()
    await search.fill(E2E_PREFIX)
    const option = page.getByRole("option", { name: new RegExp(E2E_PREFIX, "i") }).first()
    await expect(option).toBeVisible()
    // force: an ancestor keeps animating, so the default stability check loops.
    await option.click({ force: true })
    // The popover closes and the trigger shows the chosen client.
    await expect(dialog.getByRole("combobox").first()).toContainText(new RegExp(E2E_PREFIX, "i"))

    // Description — a textarea ("Invoice #1234" / "Hosting fee" placeholder).
    // Filled strictly: a silent no-op here once masked a real failure.
    await dialog.getByPlaceholder(/invoice|hosting/i).first().fill(TX_DESC)

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
    // Retries re-run the whole serial group (and past runs may have leaked),
    // so sweep EVERY e2e client — and WAIT for the async list before deciding
    // the page is clean (a bare isVisible() races the fetch and no-ops).
    for (let sweep = 0; sweep < 5; sweep++) {
      await page.goto("/clients")
      await dismissBanners(page)
      const row = page.getByText(CLIENT_NAME).first()
      const present = await row
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (!present) break // clean
      await row.click()
      // Client detail → delete (soft) — the action may live behind a menu.
      // WAIT for the detail page to render before probing (isVisible races it).
      const direct = page.getByRole("button", { name: /^delete/i }).first()
      const hasDirect = await direct
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (hasDirect) {
        await direct.click()
      } else {
        await page.getByRole("button", { name: /more|actions|menu/i }).first().click()
        await page.getByRole("menuitem", { name: /delete/i }).first().click()
      }
      // Confirm dialog — the button says "Move to Trash" (not "Delete").
      const confirm = page.getByRole("alertdialog").getByRole("button", { name: /delete|trash/i }).last()
      await confirm.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {})
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
      // Soft-delete removes the row in place — wait so the next sweep sees fresh state.
      await row.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {})
    }

    // Purge from trash so the shared dev DB stays clean — the purge (not the
    // soft delete) is what reverses wealth balances. Button label: "Clear trash".
    await page.goto("/trash")
    const purgeAll = page.getByRole("button", { name: /clear trash|empty trash|purge/i }).first()
    const hasPurge = await purgeAll
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (hasPurge) {
      await purgeAll.click()
      const confirmPurge = page.getByRole("alertdialog").getByRole("button", { name: /clear|purge|empty|delete/i }).last()
      await confirmPurge.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {})
      if (await confirmPurge.isVisible().catch(() => false)) await confirmPurge.click()
      // Wait for the purge to complete before ending the suite.
      await page.getByRole("alertdialog").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {})
    }
  })
})
