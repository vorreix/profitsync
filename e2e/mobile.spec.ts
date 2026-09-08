import { expect, test, type Page } from "@playwright/test"
import { E2E_PREFIX, ensureBank } from "./helpers"

/** Mobile shell smoke: bottom tab bar present, core tabs navigate. */
test("mobile shell renders with bottom tabs", async ({ page }) => {
  await page.goto("/dashboard")
  const tabBar = page.getByRole("link", { name: /home/i }).first()
  await expect(tabBar).toBeVisible({ timeout: 20_000 })
  await page.getByRole("link", { name: /transactions/i }).first().click()
  await expect(page).toHaveURL(/transactions/)
})

type OrgRow = { id: string; is_personal: boolean }
type CardRow = { id: string; name: string }

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk
      return !!c?.loaded && !!c.session
    },
    null,
    { timeout: 30_000 },
  )
  return page.evaluate(
    async ({ method, path, body }) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
      const orgId = localStorage.getItem("ps_active_org") ?? ""
      const res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(orgId ? { "x-org-id": orgId } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let json: unknown = null
      try { json = text ? JSON.parse(text) : null } catch { json = text }
      return { status: res.status, json: json as never }
    },
    { method, path, body },
  )
}

/**
 * The card fan — phone only, and the reason this spec has an API helper: the
 * fan needs at least two cards, so it makes its own rather than depending on
 * whatever the rest of the suite happened to leave behind.
 *
 * What it guards: the strip's icon opens the deck, the arrows move the card in
 * hand, and holding that card and dragging along the fan reorders it — saved,
 * so the new order survives a reload. Two debit cards only, so nothing here can
 * touch the free plan's single credit-card slot.
 */
test("the card fan browses and reorders on a phone", async ({ page }) => {
  const made: string[] = []
  await page.goto("/dashboard")
  await expect(page.getByRole("link", { name: /home/i }).first()).toBeVisible({ timeout: 20_000 })

  // The saved storage state points at the business workspace; the personal one
  // is where the suite keeps its bank account.
  const { json: orgs } = await api<OrgRow[]>(page, "GET", "/api/organizations")
  const personal = orgs.find((o) => o.is_personal)
  expect(personal, "a personal workspace").toBeTruthy()
  const restore = await page.evaluate(() => localStorage.getItem("ps_active_org") ?? "")
  await api(page, "POST", "/api/organizations/switch", { organization_id: personal!.id })
  await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, personal!.id)

  try {
    // Created rather than assumed: this used to pass only because an earlier
    // run had left a bank behind (see ensureBank).
    const bank = await ensureBank(page, api)

    for (const [i, tail] of [["a", "7311"], ["b", "7322"]].entries()) {
      const { status, json } = await api<CardRow>(page, "POST", "/api/cards", {
        kind: "debit",
        account_id: bank.id,
        name: `${E2E_PREFIX}-fan-${tail[0]}`,
        network: i === 0 ? "visa" : "mastercard",
        last4: tail[1],
        expiry_month: 6,
        expiry_year: 2031,
        holder_name: "E2E BOT",
        tier: "standard",
      })
      expect(status, JSON.stringify(json)).toBe(201)
      made.push(json.id)
    }

    await page.goto("/wealth?tab=cards")
    await expect(page.getByRole("tab", { name: /cards/i })).toBeVisible({ timeout: 20_000 })
    await page.getByRole("button", { name: /browse your cards/i }).click()
    const drawer = page.locator("[data-slot=drawer-content]")
    await expect(drawer).toBeVisible({ timeout: 15_000 })

    // "1 of N" says which card is in hand without depending on any card's name.
    const position = async () => {
      const text = await drawer.getByText(/\d+ of \d+/).innerText()
      return Number(text.match(/(\d+) of (\d+)/)![1])
    }
    expect(await position()).toBe(1)
    await expect(drawer.getByRole("button", { name: /previous card/i })).toBeDisabled()

    // The arrows are the assistive path to the same thing as a swipe.
    await drawer.getByRole("button", { name: /next card/i }).click()
    await expect.poll(position, { timeout: 5_000 }).toBe(2)

    // Hold the card in hand, drag one slot along the fan, release. The new
    // order is persisted, so it is still there after a reload.
    const order = () => page.locator("[data-card-drag]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cardDrag))
    const before = await order()
    const stage = drawer.locator("[data-vaul-no-drag]")
    const box = (await stage.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + 90
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.waitForTimeout(520) // longer than the hold threshold
    await page.mouse.move(cx - 130, cy, { steps: 10 })
    await page.waitForTimeout(150)
    await page.mouse.up()

    await expect.poll(order, { timeout: 10_000 }).not.toEqual(before)
    const afterDrag = await order()
    await page.reload()
    await expect(page.getByRole("tab", { name: /cards/i })).toBeVisible({ timeout: 20_000 })
    await expect.poll(order, { timeout: 15_000 }).toEqual(afterDrag)
  } finally {
    for (const id of made) await api(page, "DELETE", `/api/cards/${id}`).catch(() => {})
    if (restore) {
      await api(page, "POST", "/api/organizations/switch", { organization_id: restore }).catch(() => {})
      await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, restore)
    }
  }
})
