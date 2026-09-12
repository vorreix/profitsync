import { expect, test, type Browser, type Page } from "@playwright/test"
import { E2E_PREFIX, expectAppShell } from "./helpers"

/**
 * Budgets (v3): a named limit over a window, scoped to categories, with
 * sub-budgets. What this guards is the part unit tests cannot reach: that a
 * budget created through the dialog lands in the list, that a real expense in
 * its category moves its figure through the aggregate SQL, that a sub-budget
 * from the detail page counts inside its parent, that the ⋯ menu pauses and
 * resumes, that every control is a real touch target on a phone, and that a
 * business workspace keeps its client spend caps underneath.
 *
 * It runs in the e2e user's PERSONAL workspace, pinned explicitly (the saved
 * storage state carries the business org), and restores the business org in
 * `afterAll` — playwright runs with `workers: 1`, so a left-behind switch
 * would move every later spec's data into the wrong org.
 */

type OrgRow = { id: string; is_personal: boolean }
type Account = { id: string; type: string; archived_at: string | null }
type BudgetRow = { id: string; parent_id: string | null; name: string; amount: number; spent: number; remaining: number; categories: string[]; status: string; state: string; children_count: number }
type Listing = { budgets: BudgetRow[]; today: string }

const BUDGET_NAME = `${E2E_PREFIX} Food`
const SUB_NAME = `${E2E_PREFIX} Supplies`
const TX_DESC = `${E2E_PREFIX} groceries run`
const CATEGORY = "Supplies" // one of the seeded expense categories

let activeOrgId = ""
let restoreOrgId = ""
let budgetId = ""
let txId = ""
const extraIds: string[] = []

async function waitForClerk(page: Page) {
  await page.waitForFunction(() => {
    const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk
    return !!c?.loaded && !!c.session
  }, null, { timeout: 30_000 })
}

/** Call the app's own API with the page's real Clerk session, pinned to `activeOrgId`. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await waitForClerk(page)
  return page.evaluate(
    async ({ method, path, body, orgId }) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
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
    { method, path, body, orgId: activeOrgId },
  )
}

async function switchWorkspace(page: Page, want: "personal" | string): Promise<string> {
  const { json: orgs } = await api<OrgRow[]>(page, "GET", "/api/organizations")
  const pick = want === "personal" ? orgs.find((o) => o.is_personal) : orgs.find((o) => o.id === want)
  expect(pick, `no ${want} workspace among ${orgs.length}`).toBeTruthy()
  const res = await api(page, "POST", "/api/organizations/switch", { organization_id: pick!.id })
  expect(res.status).toBe(200)
  activeOrgId = pick!.id
  await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, pick!.id)
  return pick!.id
}

async function inFreshTab<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user.json" })
  const page = await context.newPage()
  try {
    await page.goto("/dashboard")
    return await fn(page)
  } finally {
    await context.close()
  }
}

/** A failed earlier run leaves prefixed rows behind; sibling names are unique, so sweep them first. */
async function sweep(page: Page) {
  const { json } = await api<Listing>(page, "GET", "/api/spending-budgets")
  for (const b of (json.budgets ?? []).filter((x) => !x.parent_id && x.name.startsWith(E2E_PREFIX))) {
    await api(page, "DELETE", `/api/spending-budgets/${b.id}`)
  }
  const { json: tx } = await api<{ data: { id: string; description: string }[] }>(page, "GET", `/api/transactions?search=${encodeURIComponent(TX_DESC)}&page=1`)
  const ids = (tx?.data ?? []).filter((t) => t.description === TX_DESC).map((t) => t.id)
  if (ids.length) {
    await api(page, "POST", "/api/transactions/bulk-delete", { ids })
    await api(page, "POST", "/api/trash/clear")
  }
}

const listing = async (page: Page) => (await api<Listing>(page, "GET", "/api/spending-budgets")).json.budgets

test.describe.serial("Budgets", () => {
  test.beforeAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      restoreOrgId = (await page.evaluate(() => localStorage.getItem("ps_active_org"))) ?? ""
      await switchWorkspace(page, "personal")
      await sweep(page)
    })
  })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ }
    }, activeOrgId)
  })

  test.afterAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      await switchWorkspace(page, "personal")
      if (budgetId) await api(page, "DELETE", `/api/spending-budgets/${budgetId}`)
      for (const id of extraIds) await api(page, "DELETE", `/api/spending-budgets/${id}`)
      if (txId) {
        await api(page, "POST", "/api/transactions/bulk-delete", { ids: [txId] })
        await api(page, "POST", "/api/trash/clear")
      }
      await sweep(page)
      if (restoreOrgId) await switchWorkspace(page, restoreOrgId).catch(() => {})
    })
  })

  test("creates a category budget through the dialog", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    await page.getByTestId("budget-add").first().click()
    await page.locator("#sb-name").fill(BUDGET_NAME)
    await page.locator("#sb-amount").fill("300")
    // Monthly is the default. Scope it to one category.
    await page.getByRole("button", { name: /only count some categories/i }).click()
    await page.getByRole("button", { name: CATEGORY, exact: true }).click()
    await page.getByTestId("budget-save").click()

    const row = page.locator(`li[data-budget]`).filter({ hasText: BUDGET_NAME })
    await expect(row).toBeVisible({ timeout: 15_000 })

    const created = (await listing(page)).find((b) => b.name === BUDGET_NAME)
    expect(created, "the budget is in the API listing").toBeTruthy()
    expect(created!.amount).toBe(300)
    expect(created!.categories).toEqual([CATEGORY])
    expect(created!.parent_id).toBeNull()
    budgetId = created!.id
  })

  test("an expense in its category moves its figure", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    const { json: accounts } = await api<Account[]>(page, "GET", "/api/wealth/accounts")
    const cash = accounts.find((a) => a.type === "cash" && !a.archived_at)
    expect(cash, "the personal workspace has its permanent Cash account").toBeTruthy()
    const { json: today } = await api<Listing>(page, "GET", "/api/spending-budgets")
    const res = await api<{ id: string }>(page, "POST", "/api/transactions", {
      type: "outgoing",
      amount: 45,
      description: TX_DESC,
      category: CATEGORY,
      date: today.today,
      wealth_account_id: cash!.id,
    })
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    txId = res.json.id

    const after = (await listing(page)).find((b) => b.id === budgetId)!
    expect(after.spent).toBe(45)
    expect(after.remaining).toBe(255)
    expect(after.state).toBe("ok")

    await page.reload()
    await expectAppShell(page)
    const row = page.locator(`li[data-budget="${budgetId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(/255/)
  })

  test("a budget with no sub-budgets still offers a way to add one", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    const row = page.locator(`li[data-budget="${budgetId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    // Every budget folds open, whether or not it already has sub-budgets — that
    // is where "add a sub-budget" used to be unreachable. Retried as a unit: the
    // list revalidates in the background, and a tap that lands mid-render is
    // lost rather than wrong.
    await expect(async () => {
      await row.getByRole("button", { name: /show what is inside/i }).click()
      await expect(page.getByTestId("add-sub-inline")).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test("the detail page adds a sub-budget that counts inside its parent", async ({ page }) => {
    await page.goto(`/budgets/${budgetId}`)
    await expectAppShell(page)
    await expect(page.getByTestId("budget-hero")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("budget-add-sub").click()
    // The parent's free categories arrive already ticked — splitting by category
    // is the whole point — and the name follows the first of them.
    await expect(page.locator("#sb-name")).toHaveValue(CATEGORY, { timeout: 10_000 })
    await expect(page.getByRole("button", { name: CATEGORY, exact: true })).toHaveAttribute("aria-pressed", "true")
    await page.locator("#sb-name").fill(SUB_NAME)
    await page.locator("#sb-amount").fill("100")
    await page.getByTestId("budget-save").click()

    const subs = page.getByTestId("sub-budgets").locator("li[data-budget]")
    await expect(subs).toHaveCount(1, { timeout: 15_000 })
    await expect(subs.first()).toContainText(SUB_NAME)

    const rows = await listing(page)
    const sub = rows.find((b) => b.name === SUB_NAME)!
    expect(sub.parent_id).toBe(budgetId)
    expect(sub.spent).toBe(45)
    expect(sub.remaining).toBe(55)
    // Everything in the parent is claimed by the sub-budget: no remainder line.
    await expect(page.getByText(/not in any sub-budget/i)).toHaveCount(0)
  })

  test("a second sub-budget cannot claim the same category", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    const res = await api<{ error: string; by?: string }>(page, "POST", "/api/spending-budgets", {
      name: `${E2E_PREFIX} clash`,
      amount: 10,
      categories: [CATEGORY],
      parent_id: budgetId,
    })
    expect(res.status).toBe(409)
    expect(res.json.error).toBe("category_claimed")
    expect(res.json.by).toBe(SUB_NAME)
  })

  test("the view toggle re-expresses every budget without asking the server again", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    await expect(page.getByTestId("view-toggle")).toBeVisible({ timeout: 15_000 })
    const row = page.locator(`li[data-budget="${budgetId}"]`)
    const monthly = await row.innerText()

    const calls: string[] = []
    page.on("request", (r) => { if (r.url().includes("/api/spending-budgets")) calls.push(r.url()) })
    await page.getByTestId("view-weekly").click()
    await expect(row).not.toHaveText(monthly, { timeout: 10_000 })
    // A monthly 300 read by the week is 300 / 30.436875 × 7 ≈ 69.
    await expect(row).toContainText("69")
    // …and it says what was actually set, so the converted figure cannot mislead.
    await expect(row).toContainText(/300/)
    expect(calls, "the toggle is a re-render, not a request").toEqual([])
    await page.getByTestId("view-monthly").click()
    await expect(row).toContainText("300.00")
  })

  test("the ⋯ menu closes and reopens a budget, and closed ones fold away", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    const row = page.locator(`li[data-budget="${budgetId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole("button", { name: /more actions/i }).first().click()
    await page.getByRole("menuitem", { name: /^close$/i }).click()
    await expect(page.getByTestId("closed-toggle")).toBeVisible({ timeout: 15_000 })
    expect((await listing(page)).find((b) => b.id === budgetId)!.status).toBe("closed")
    // Closing a parent closes what is inside it, so nothing keeps counting off-screen.
    expect((await listing(page)).filter((b) => b.parent_id === budgetId).every((b) => b.status === "closed")).toBe(true)

    await page.getByTestId("closed-toggle").click()
    const closedRow = page.getByTestId("closed-list").locator(`li[data-budget="${budgetId}"]`)
    await expect(closedRow).toBeVisible({ timeout: 10_000 })
    await closedRow.getByRole("button", { name: /more actions/i }).first().click()
    await page.getByRole("menuitem", { name: /^reopen$/i }).click()
    await expect(page.getByTestId("budget-list").locator(`li[data-budget="${budgetId}"]`)).toBeVisible({ timeout: 15_000 })
    expect((await listing(page)).find((b) => b.id === budgetId)!.status).toBe("active")
  })

  test("reorder mode puts a grip on every budget and the new order sticks", async ({ page }) => {
    await page.goto("/budgets")
    await expectAppShell(page)
    // A second budget, so there is an order to change.
    const second = await api<{ id: string }>(page, "POST", "/api/spending-budgets", {
      name: `${E2E_PREFIX} Travel`, amount: 120, period: "monthly", categories: ["Travel"],
    })
    expect(second.status, JSON.stringify(second.json)).toBe(201)
    extraIds.push(second.json.id)

    await page.reload()
    await expectAppShell(page)
    await page.getByTestId("reorder-toggle").click()
    const grips = page.getByRole("button", { name: /drag to reorder/i })
    await expect(grips.first()).toBeVisible({ timeout: 10_000 })
    expect(await grips.count()).toBeGreaterThanOrEqual(2)

    // The keyboard/menu path is the accessible equivalent of the drag.
    await page.getByTestId("reorder-toggle").click()
    const before = (await listing(page)).filter((b) => !b.parent_id && b.name.startsWith(E2E_PREFIX)).map((b) => b.id)
    // The FIRST row: the floating action button sits over the bottom-right of
    // the viewport, where the last row's menu would be.
    const first = page.locator(`li[data-budget="${before[0]}"]`)
    await first.getByRole("button", { name: /more actions/i }).first().click()
    await page.getByRole("menuitem", { name: /move down/i }).click()
    await page.waitForTimeout(1500)
    const after = (await listing(page)).filter((b) => !b.parent_id && b.name.startsWith(E2E_PREFIX)).map((b) => b.id)
    expect(after).not.toEqual(before)
  })

  test("the analytics tab answers what the list cannot", async ({ page }) => {
    await page.goto("/budgets?tab=analytics")
    await expectAppShell(page)
    const panel = page.getByTestId("budget-analytics")
    await expect(panel).toBeVisible({ timeout: 20_000 })
    const headings = await panel.locator("h2").allTextContents()
    expect(headings.length).toBeGreaterThanOrEqual(3)
    // The one number only this screen has: spend no budget covers.
    await expect(panel).toContainText(/not in any budget/i)
  })

  test("controls meet the 44 px touch floor at a phone width, with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 })
    await page.goto("/budgets")
    await expectAppShell(page)
    await expect(page.locator(`li[data-budget="${budgetId}"]`)).toBeVisible({ timeout: 15_000 })
    const boxes = await page.locator("main button:visible, [data-testid='budgets-monthly'] button:visible").evaluateAll((els) =>
      els.map((el) => ({ h: el.getBoundingClientRect().height, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30) })),
    )
    const short = boxes.filter((b) => b.h > 0 && b.h < 44)
    expect(short, `controls under 44 px: ${JSON.stringify(short)}`).toEqual([])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflow).toBe(false)
  })

  test("a business workspace keeps its client spend caps under the budgets", async ({ page }) => {
    await page.goto("/dashboard")
    await expectAppShell(page)
    expect(restoreOrgId, "a business workspace to switch to").toBeTruthy()
    await switchWorkspace(page, restoreOrgId)
    await page.goto("/budgets")
    await expectAppShell(page)
    await expect(page.getByTestId("client-budgets")).toBeVisible({ timeout: 15_000 })
    await switchWorkspace(page, "personal")
  })
})
