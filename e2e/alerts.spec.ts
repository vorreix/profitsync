import { expect, test, type Page } from "@playwright/test"

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await page.waitForFunction(() => {
    const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk
    return !!c?.loaded && !!c.session
  }, null, { timeout: 30_000 })
  return page.evaluate(async ({ method, path, body }) => {
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
  }, { method, path, body })
}

/** Stable, so each run restores the same account instead of adding one. */
const FUND_NAME = "E2E Alerts Bank"

const iso = (base: string, days: number) => new Date(Date.parse(`${base}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/**
 * The dashboard attention rail.
 *
 * It seeds its own conditions — a charge the account cannot cover, a card about
 * to expire, two ordinary upcoming payments — because the shared e2e workspace
 * is swept clean by other specs and a rail with nothing to say is (correctly)
 * invisible. Everything it creates is removed in the `finally`.
 *
 * What it guards is the part unit tests cannot reach: that the derived items
 * survive the round trip through real SQL, that the rail reaches the screen,
 * that its dots are real controls, that off-screen slides leave the
 * accessibility tree, and that Arabic does not send it off the side of the page.
 */
test("the dashboard attention rail shows, orders and mirrors correctly", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto("/dashboard")
  await expect(page.getByRole("link", { name: /home|dashboard/i }).first()).toBeVisible({ timeout: 20_000 })

  const { json: first } = await api<{ today: string }>(page, "GET", "/api/alerts")
  const today = first.today
  const { json: accounts } = await api<{ id: string; type: string; archived_at: string | null; current_balance: string }[]>(page, "GET", "/api/wealth/accounts")
  const cash = accounts.find((a) => a.type === "cash" && !a.archived_at)!
  const bal = Number(cash.current_balance) || 0
  // The calm "coming up" slides must live on a DIFFERENT, healthy account:
  // anything landing on an account the projection shows going short is
  // deliberately suppressed in favour of the shortfall slide.
  const healthy = accounts.find((a) => !a.archived_at && a.id !== cash.id && Number(a.current_balance) > 100)

  const made: string[] = []
  const madeCards: string[] = []
  const madeAccounts: string[] = []
  const mk = async (name: string, amount: number, day: number, accountId = cash.id) => {
    const r = await api<{ id: string }>(page, "POST", "/api/recurring", {
      name, type: "outgoing", amount, frequency_unit: "month", frequency_interval: 1,
      start_date: iso(today, day), wealth_account_id: accountId, category: "Rent",
    })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    made.push(r.json.id)
  }

  try {
    // The shared workspace gets swept down to Cash by other specs, so this one
    // needs a healthy account of its own. It RESTORES the account it made last
    // time rather than making another: deleting an account that has any
    // transaction only ARCHIVES it — and an opening balance IS a transaction —
    // so create-and-delete leaks one row per run, forever.
    let fund = healthy
    if (!fund) {
      const mine = accounts.find((a) => (a.nickname || a.bank_name) === FUND_NAME)
      if (mine) {
        const restored = await api(page, "PATCH", `/api/wealth/accounts/${mine.id}`, { restore: true })
        if (restored.status === 200) fund = { ...mine, archived_at: null } as never
      }
      if (!fund) {
        // A free plan allows one ACTIVE bank; if this workspace has already
        // spent it, seeding is skipped and the rail is asserted on what it has.
        const created = await api<{ id: string }>(page, "POST", "/api/wealth/accounts", {
          type: "bank", bankName: FUND_NAME, nickname: FUND_NAME, icon: "bank", openingBalance: 25000,
        })
        if (created.status === 201) fund = { ...created.json, type: "bank", archived_at: null, current_balance: "25000" } as never
      }
      if (fund) madeAccounts.push(fund.id)
    }

    await mk("E2E Rent", Math.max(0, bal) + 5000, 1) // danger: shortfall tomorrow
    if (fund) {
      await mk("E2E Gym membership", 1, 3, fund.id) // info: coming up
      await mk("E2E Spotify family plan", 1, 2, fund.id) // info: coming up
    }

    // A DEBIT card expiring this month → a warning slide, from a different
    // source than the shortfall, so the rail has more than one tone in it.
    // Debit cards are outside the free plan's single credit-card slot.
    const bank = fund
    if (bank) {
      const [y, m] = today.split("-").map(Number)
      const card = await api<{ id: string }>(page, "POST", "/api/cards", {
        kind: "debit", account_id: bank.id, name: "E2E-alerts debit", network: "visa",
        last4: "4417", expiry_month: m, expiry_year: y, holder_name: "E2E BOT", tier: "standard",
      })
      if (card.status === 201) madeCards.push(card.json.id)
    }

    const { json } = await api<{ items: { kind: string; severity: string }[] }>(page, "GET", "/api/alerts")
    // Worst first: the ordering is what makes a rail readable at a glance.
    expect(json.items[0].severity).toBe("danger")
    expect(json.items.length).toBeGreaterThanOrEqual(1)

    await page.reload()
    await expect(page.getByRole("link", { name: /home|dashboard/i }).first()).toBeVisible({ timeout: 20_000 })
    const slide = page.getByText(/may not cover|Payment coming up/i).first()
    await expect(slide).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: "/tmp/alerts-mobile.png", clip: { x: 0, y: 0, width: 430, height: 420 } })

    // Dots are real controls: tab order and activation.
    const tabs = page.getByRole("tab")
    const n = await tabs.count()
    if (n < 2) return // a single slide renders without carousel chrome, by design
    expect(n).toBeGreaterThan(1)
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true")
    await tabs.nth(1).click()
    await expect.poll(async () => await tabs.nth(1).getAttribute("aria-selected"), { timeout: 5000 }).toBe("true")
    await page.waitForTimeout(600) // let the scroll settle before capturing
    await page.screenshot({ path: "/tmp/alerts-slide2.png", clip: { x: 0, y: 0, width: 430, height: 420 } })

    // Only the visible slide is exposed to assistive tech.
    const ltrOverflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(ltrOverflow.scroll).toBeLessThanOrEqual(ltrOverflow.client)

    // Only what you can do nothing about is closable. An expiring card is the
    // warning-tier exception; everything with an action behind it clears by
    // being fixed, not by being waved away.
    for (const kind of ["card_payment_overdue", "card_autopay_failed", "charge_shortfall", "card_expired", "card_payment_due_soon", "recurring_paused", "card_utilization_high"]) {
      const el = page.locator(`[data-alert="${kind}"]`)
      if (await el.count()) await expect(el.first().getByRole("button", { name: /dismiss/i })).toHaveCount(0)
    }
    const expiring = page.locator('[data-alert="card_expiring"]')
    if (await expiring.count()) await expect(expiring.first().getByRole("button", { name: /dismiss/i })).toHaveCount(1)

    const hidden = await page.locator('[data-slot="carousel-item"][aria-hidden="true"]').count()
    expect(hidden).toBe(n - 1)

    // RTL: Arabic must start on the right end with the worst item in view.
    await page.evaluate(() => localStorage.setItem("profitsync-language", "ar"))
    await page.reload()
    await expect(page.locator("html[dir=rtl]")).toBeAttached({ timeout: 20_000 })
    const arTabs = page.getByRole("tab")
    await expect(arTabs.nth(0)).toHaveAttribute("aria-selected", "true", { timeout: 20_000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: "/tmp/alerts-rtl.png", clip: { x: 0, y: 0, width: 430, height: 420 } })
    // The repo's hard rule: the page body never scrolls horizontally. A
    // carousel with a negative track margin is exactly the thing that breaks it.
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)
  } finally {
    await page.evaluate(() => localStorage.setItem("profitsync-language", "en"))
    for (const id of made) await api(page, "DELETE", `/api/recurring/${id}`).catch(() => {})
    for (const id of madeCards) await api(page, "DELETE", `/api/cards/${id}`).catch(() => {})
    // Archives it — the next run restores it rather than adding another.
    for (const id of madeAccounts) await api(page, "DELETE", `/api/wealth/accounts/${id}`).catch(() => {})
  }
})
