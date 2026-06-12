import { expect, test } from "@playwright/test"

/** Mobile shell smoke: bottom tab bar present, core tabs navigate. */
test("mobile shell renders with bottom tabs", async ({ page }) => {
  await page.goto("/dashboard")
  const tabBar = page.getByRole("link", { name: /home/i }).first()
  await expect(tabBar).toBeVisible({ timeout: 20_000 })
  await page.getByRole("link", { name: /transactions/i }).first().click()
  await expect(page).toHaveURL(/transactions/)
})
