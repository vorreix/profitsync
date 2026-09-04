import { expect, test, type Browser, type Page } from "@playwright/test"
import { E2E_PREFIX, dismissBanners, expectAppShell } from "./helpers"

/**
 * Credit cards — end-to-end through the real UI, the real auth guard and the
 * real ledger. The accounting invariants are pinned by DB-free unit tests
 * (src/lib/credit-card*.test.ts, tx-classify.test.ts, api/_lib/tx-sql.test.ts);
 * what only a browser + database can prove is that the routes wire them
 * together: creating a card with a known statement, buying on it, paying the
 * statement in parts, refunds, fees, an overpayment, and that trash / restore /
 * edit reverse and re-apply exactly once — with the paying bank account moving
 * by exactly the payments and nothing else.
 *
 * WORKSPACE: uses the e2e user's PERSONAL workspace (no client picker) and
 * switches back afterwards — playwright runs with `workers: 1`, so a leftover
 * switch would move every later spec's data into the wrong org.
 */

type OrgRow = { id: string; name: string; is_personal: boolean }
type Account = { id: string; type: string; nickname: string; bank_name: string; current_balance: string | number; is_default?: boolean; archived_at: string | null }
type Tx = { id: string; kind: string; type: string; amount: string | number; description: string; is_system?: boolean }
type CardSummary = {
  usage: { debt: number; credit: number; available: number | null }
  statement: { status: string; paid: number; remaining: number; statementBalance: number } | null
  cycle: { spent: number; refunds: number; payments: number }
}

const CARD_NAME = `${E2E_PREFIX}-visa`

// Reported EXPENSE for the card's rows under the app's own rules
// (src/lib/tx-classify.ts): standard outgoing counts, a refund subtracts, a
// transfer (card payment) and a system Opening Balance row count nothing.
const expenseOf = (rows: Tx[]) =>
  rows.reduce((sum, t) => {
    if (t.is_system) return sum
    if (t.kind === "standard" && t.type === "outgoing") return sum + Number(t.amount)
    if (t.kind === "refund") return sum - Number(t.amount)
    return sum
  }, 0)

async function waitForClerk(page: Page) {
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk
      return !!c?.loaded && !!c.session
    },
    null,
    { timeout: 30_000 },
  )
}

/**
 * Call the app's own API with the page's real Clerk session. No `x-org-id`
 * header on purpose: the saved storage state carries a STALE `ps_active_org`
 * mirror (the business org) until the app reconciles it after boot, so the
 * server's fallback — the profile's current workspace, switched to PERSONAL in
 * beforeAll — is the only value that is right at every moment of a test.
 */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await waitForClerk(page)
  return page.evaluate(
    async ({ method, path, body }) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
      const res = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
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

async function switchWorkspace(page: Page, want: "personal" | string): Promise<string> {
  const { json: orgs } = await api<OrgRow[]>(page, "GET", "/api/organizations")
  const pick = want === "personal" ? orgs.find((o) => o.is_personal) : orgs.find((o) => o.id === want)
  expect(pick, `no ${want} workspace among ${orgs.length}`).toBeTruthy()
  const res = await api(page, "POST", "/api/organizations/switch", { organization_id: pick!.id })
  expect(res.status).toBe(200)
  await page.evaluate(() => { try { localStorage.removeItem("ps_active_org") } catch { /* private mode */ } })
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

/**
 * Switch AND reboot into a workspace. The saved storage state carries the
 * business org's `ps_active_org` mirror, so a switch alone is not enough — the
 * next page load must read the profile again, or every API call in this tab
 * (cleanup included) still targets the old org.
 */
async function useWorkspace(page: Page, want: "personal" | string): Promise<string> {
  const id = await switchWorkspace(page, want)
  await page.goto("/dashboard")
  await expectAppShell(page)
  return id
}

const cardSummary = async (page: Page, id: string) => (await api<CardSummary>(page, "GET", `/api/wealth/accounts/${id}/card`)).json
const accounts = async (page: Page) => (await api<Account[]>(page, "GET", "/api/wealth/accounts")).json
const cardTx = async (page: Page, id: string) =>
  (await api<{ data: Tx[]; summary: { incoming: number; outgoing: number } }>(page, "GET", `/api/transactions?wealthAccountId=${id}&page=1`)).json

/** Remove anything a previous (aborted) run left behind. */
async function cleanup(page: Page) {
  const accs = await accounts(page)
  console.log(`[cleanup] accounts: ${accs.map((a) => a.nickname || a.bank_name).join(", ")}`)
  for (const a of accs.filter((x) => x.nickname === CARD_NAME)) {
    const { data } = await cardTx(page, a.id)
    if (data.length) {
      const bd = await api(page, "POST", "/api/transactions/bulk-delete", { ids: data.map((t) => t.id) })
      console.log(`[cleanup] bulk-delete ${data.length} -> ${bd.status}`)
    }
    const clear = await api(page, "POST", "/api/trash/clear")
    const del = await api(page, "DELETE", `/api/wealth/accounts/${a.id}`)
    console.log(`[cleanup] trash/clear -> ${clear.status}, delete card -> ${del.status}`)
  }
}

// The statement the card is onboarded with: closed on the 1st of the current
// month (or last month if today IS the 1st), due on the 15th after it.
function knownStatementDates(): { closing: string; due: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const iso = (yy: number, mm: number, d: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  const closingMonth = now.getUTCDate() > 1 ? { y, m } : m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  return { closing: iso(closingMonth.y, closingMonth.m, 1), due: iso(closingMonth.y, closingMonth.m, 15) }
}

test.describe.serial("Credit cards", () => {
  let restoreOrgId = ""
  let cardId = ""
  let sourceId = ""
  let sourceBefore = 0

  test.beforeAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      restoreOrgId = await page.evaluate(() => localStorage.getItem("ps_active_org") ?? "")
      await useWorkspace(page, "personal")
      await cleanup(page)
    })
  })

  test.afterAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      await useWorkspace(page, "personal")
      await cleanup(page)
      if (restoreOrgId) await switchWorkspace(page, restoreOrgId).catch(() => {})
    })
  })

  test("create a card with a known statement — the tile shows what is owed, not a negative balance", async ({ page }) => {
    await page.goto("/wealth")
    await expectAppShell(page)
    await dismissBanners(page)
    await page.getByRole("button", { name: /add card/i }).first().click()
    const dialog = page.getByRole("dialog", { name: /add credit card/i })
    await expect(dialog).toBeVisible()

    await dialog.getByPlaceholder(/search bank name/i).fill("E2E Card Bank")
    await page.keyboard.press("Tab")
    await dialog.getByLabel(/nickname/i).fill(CARD_NAME)
    await dialog.getByLabel(/credit limit/i).fill("2000")
    await dialog.getByLabel(/amount you owe/i).fill("950")
    await dialog.getByLabel(/statement closes on day/i).fill("1")
    await dialog.getByLabel(/payment due on day/i).fill("15")
    await dialog.getByRole("switch", { name: /latest statement/i }).click()
    const { closing, due } = knownStatementDates()
    await dialog.getByLabel(/statement balance/i).fill("800")
    await dialog.getByLabel(/statement closing date/i).fill(closing)
    await dialog.getByLabel(/payment due date/i).fill(due)
    await dialog.getByRole("button", { name: /^add card$/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    // The tile: "€950.00 owed" + "€1,050.00 available of €2,000.00".
    const tile = page.locator("[data-account-card]").filter({ hasText: CARD_NAME }).first()
    await expect(tile).toBeVisible({ timeout: 15_000 })
    await expect(tile).toContainText(/950\.00 owed/)
    await expect(tile).toContainText(/1,050\.00 available of .*2,000\.00/)
    await expect(tile).not.toContainText(/-950/)

    // Net worth shows the liability separately.
    await expect(page.getByText(/owed on cards/i).first()).toBeVisible()

    const accs = await accounts(page)
    const card = accs.find((a) => a.nickname === CARD_NAME)
    expect(card).toBeTruthy()
    cardId = card!.id
    expect(Number(card!.current_balance)).toBe(-950)
    // The account we will pay from: the default or first non-card, non-space account.
    const source = accs.find((a) => a.is_default && a.type !== "credit_card") ?? accs.find((a) => a.type === "bank" || a.type === "cash")
    expect(source).toBeTruthy()
    sourceId = source!.id
    sourceBefore = Number(source!.current_balance)

    const s = await cardSummary(page, cardId)
    expect(s.usage).toMatchObject({ debt: 950, credit: 0, available: 1050 })
    expect(s.statement).toMatchObject({ status: "unpaid", statementBalance: 800, paid: 0, remaining: 800 })
    // The opening debt is a system row: no spend, no expense.
    expect(s.cycle).toMatchObject({ spent: 0, refunds: 0, payments: 0 })
  })

  test("the card screen: owed, available, statement due, new cycle", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await dismissBanners(page)
    await expect(page.getByText(/amount you owe/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/^\D*950\.00$/).first()).toBeVisible()
    await expect(page.getByText(/800\.00 due/)).toBeVisible()
    await expect(page.getByText(/not paid yet/i).first()).toBeVisible()
    await expect(page.getByText(/0\.00 spent/)).toBeVisible()
  })

  test("a purchase on the card is an expense and increases the debt", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await page.getByRole("button", { name: /add purchase/i }).click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible()
    await sheet.locator("#qa-amount").fill("100")
    await sheet.locator("#qa-desc").fill(`${E2E_PREFIX} groceries`)
    await sheet.getByRole("button", { name: /^add$/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    await expect(page.getByText(/^\D*1,050\.00$/).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/100\.00 spent/)).toBeVisible()

    const s = await cardSummary(page, cardId)
    expect(s.usage).toMatchObject({ debt: 1050, available: 950 })
    expect(s.statement).toMatchObject({ status: "unpaid", remaining: 800 }) // new purchases never touch the statement
    expect(s.cycle.spent).toBe(100)
    const { data, summary } = await cardTx(page, cardId)
    expect(expenseOf(data)).toBe(100)
    expect(summary.incoming).toBe(0)
  })

  test("partial statement payment → Partially paid; paid + remaining shown", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await page.getByRole("button", { name: /pay statement/i }).first().click()
    const sheet = page.getByRole("dialog", { name: /pay card/i })
    await expect(sheet).toBeVisible()
    await sheet.getByRole("radio", { name: /other amount/i }).click()
    await sheet.locator("#pay-amount").fill("300")
    await sheet.getByRole("button", { name: /record payment/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    await expect(page.getByText(/partially paid/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/paid \D*300\.00/i)).toBeVisible()
    await expect(page.getByText(/500\.00 still to pay/)).toBeVisible()
    await expect(page.getByText(/^\D*750\.00$/).first()).toBeVisible()

    const s = await cardSummary(page, cardId)
    expect(s.statement).toMatchObject({ status: "partial", paid: 300, remaining: 500 })
    expect(s.usage.debt).toBe(750)
    // Paying is a transfer: no expense was added, and it is not income either.
    const { data, summary } = await cardTx(page, cardId)
    expect(expenseOf(data)).toBe(100)
    expect(summary.incoming).toBe(0)
  })

  test("paying the rest → PAID, and new-cycle spending is untouched", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await page.getByRole("button", { name: /pay statement/i }).first().click()
    const sheet = page.getByRole("dialog", { name: /pay card/i })
    // Default preset = statement remaining (500).
    await expect(sheet.locator("#pay-amount")).toHaveValue("500")
    await sheet.getByRole("button", { name: /record payment/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    await expect(page.getByRole("heading", { name: /^statement$/i })).toBeVisible()
    await expect(page.getByText(/^\D*250\.00$/).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/100\.00 spent/)).toBeVisible()

    const s = await cardSummary(page, cardId)
    expect(s.statement).toMatchObject({ status: "paid", paid: 800, remaining: 0 })
    expect(s.usage.debt).toBe(250)
    expect(s.cycle.spent).toBe(100)
    expect(s.cycle.payments).toBe(800)
  })

  test("a refund reverses spending (not income); a fee is a real expense", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await page.getByRole("button", { name: /add refund/i }).click()
    let sheet = page.getByRole("dialog")
    await expect(sheet.getByRole("radio", { name: /refund/i })).toHaveAttribute("aria-checked", "true")
    await sheet.locator("#qa-amount").fill("40")
    await sheet.locator("#qa-desc").fill(`${E2E_PREFIX} returned item`)
    await sheet.getByRole("button", { name: /^add$/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/40\.00 refunded/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: /add fee/i }).click()
    sheet = page.getByRole("dialog")
    await sheet.locator("#qa-amount").fill("10")
    await sheet.locator("#qa-desc").fill(`${E2E_PREFIX} annual fee`)
    await sheet.getByRole("button", { name: /^add$/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    await expect(page.getByText(/^\D*220\.00$/).first()).toBeVisible({ timeout: 15_000 })
    const s = await cardSummary(page, cardId)
    expect(s.usage.debt).toBe(220) // 250 − 40 + 10
    expect(s.cycle).toMatchObject({ spent: 110, refunds: 40, payments: 800 })
    const { data, summary } = await cardTx(page, cardId)
    expect(expenseOf(data)).toBe(70) // 100 + 10 − 40: the refund nets against expense
    expect(summary.incoming).toBe(0) // …and is never income (the server's incomeSumSql agrees)
    // The refund is labelled as such in the list.
    await expect(page.getByText(/^\s*refund\s*$/i).first()).toBeVisible()
  })

  test("overpaying shows card credit, never a negative debt", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await page.getByRole("button", { name: /^pay card$/i }).first().click()
    const sheet = page.getByRole("dialog", { name: /pay card/i })
    await sheet.getByRole("radio", { name: /other amount/i }).click()
    await sheet.locator("#pay-amount").fill("300")
    await sheet.getByRole("button", { name: /record payment/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/80\.00 card credit/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/-80/)).toHaveCount(0)
    const s = await cardSummary(page, cardId)
    expect(s.usage).toMatchObject({ debt: 0, credit: 80, available: 2080 })
  })

  test("trash / restore / edit reverse and re-apply exactly once; the bank moved only by the payments", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    const { data } = await cardTx(page, cardId)
    const purchase = data.find((t) => (t.description ?? "").includes("groceries"))
    const payment = data.find((t) => t.kind === "transfer" && t.type === "incoming" && Number(t.amount) === 300)
    expect(purchase, "the groceries purchase row").toBeTruthy()
    expect(payment, "a 300 card payment row").toBeTruthy()
    if (!purchase || !payment) return

    // Delete the €100 purchase → credit 180; restore → 80 again (exactly once).
    expect((await api(page, "DELETE", `/api/transactions/${purchase.id}`)).status).toBe(204)
    expect((await cardSummary(page, cardId)).usage.credit).toBe(180)
    expect((await api(page, "POST", "/api/trash/restore", { type: "transaction", id: purchase.id })).status).toBe(200)
    expect((await cardSummary(page, cardId)).usage.credit).toBe(80)

    // Delete the €300 payment (both legs) → debt 220 and the bank gets its 300 back; restore → back.
    const bankBeforeDelete = Number((await accounts(page)).find((a) => a.id === sourceId)!.current_balance)
    expect((await api(page, "DELETE", `/api/transactions/${payment.id}`)).status).toBe(204)
    let s = await cardSummary(page, cardId)
    expect(s.usage).toMatchObject({ debt: 220, credit: 0 })
    expect(Number((await accounts(page)).find((a) => a.id === sourceId)!.current_balance)).toBeCloseTo(bankBeforeDelete + 300, 2)
    expect((await api(page, "POST", "/api/trash/restore", { type: "transaction", id: payment.id })).status).toBe(200)
    s = await cardSummary(page, cardId)
    expect(s.usage.credit).toBe(80)
    expect(Number((await accounts(page)).find((a) => a.id === sourceId)!.current_balance)).toBeCloseTo(bankBeforeDelete, 2)

    // Edit the purchase 100 → 70: every figure moves by exactly 30. Then back.
    expect((await api(page, "PATCH", `/api/transactions/${purchase.id}`, { amount: 70 })).status).toBe(200)
    s = await cardSummary(page, cardId)
    expect(s.usage.credit).toBe(110)
    expect(s.cycle.spent).toBe(80)
    expect(expenseOf((await cardTx(page, cardId)).data)).toBe(40)
    expect((await api(page, "PATCH", `/api/transactions/${purchase.id}`, { amount: 100 })).status).toBe(200)
    expect((await cardSummary(page, cardId)).usage.credit).toBe(80)

    // The paying account moved by exactly the payments (300 + 500 + 300) and nothing else.
    const sourceAfter = Number((await accounts(page)).find((a) => a.id === sourceId)!.current_balance)
    expect(sourceBefore - sourceAfter).toBeCloseTo(1100, 2)
  })

  test("everything survives a reload", async ({ page }) => {
    await page.goto(`/wealth/${cardId}`)
    await expectAppShell(page)
    await page.reload()
    await expectAppShell(page)
    await expect(page.getByText(/80\.00 card credit/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/110\.00 spent/)).toBeVisible()
    await expect(page.getByText(/^\s*paid\s*$/i).first()).toBeVisible()
    await page.goto("/wealth")
    const tile = page.locator("[data-account-card]").filter({ hasText: CARD_NAME }).first()
    await expect(tile).toContainText(/80\.00 card credit/, { timeout: 15_000 })
  })
})

