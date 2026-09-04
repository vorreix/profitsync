import { expect, test, type Browser, type Page } from "@playwright/test"
import { E2E_PREFIX, dismissBanners, expectAppShell } from "./helpers"

/**
 * Debt & Loans — through the real UI, auth and database. The engine is pinned by
 * DB-free unit tests (src/lib/debt-*.test.ts); this proves the routes wire it:
 * borrowing is never income, a payment's principal is a transfer while interest
 * and fees are the only expenses, deleting a payment reverses everything at
 * once, receivables flow the other way, and the hub / planner / upcoming tabs
 * render from real data. Uses the e2e user's PERSONAL workspace (restored after).
 */

type OrgRow = { id: string; is_personal: boolean }
type Account = { id: string; type: string; nickname: string; bank_name: string; current_balance: string | number; is_default?: boolean }
type Debt = { id: string; name: string; balance: number; status: string; estimate: { kind: string } }
type Overview = { debts: Debt[]; receivables: Debt[]; summary: { owed_by_currency: { currency: string; amount: number }[]; month: { required: number; paid: number }; next_payment: { debt_id: string } | null; debt_free_date: string | null } }
type TxRow = { id: string; kind: string; type: string; amount: string | number; is_system?: boolean; description: string }

// The workspace every API call in this spec targets — set once in beforeAll.
// Explicit, because the app itself may re-sync the profile's current workspace
// from the (stale, business) `ps_active_org` it finds in the saved storage state.
let orgIdForApi = ""

async function waitForClerk(page: Page) {
  await page.waitForFunction(() => { const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk; return !!c?.loaded && !!c.session }, null, { timeout: 30_000 })
}
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await waitForClerk(page)
  return page.evaluate(async ({ method, path, body, orgId }) => {
    const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
    const token = await Clerk.session?.getToken()
    const res = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(orgId ? { "x-org-id": orgId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text(); let json: unknown = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json: json as never }
  }, { method, path, body, orgId: orgIdForApi })
}
async function useWorkspace(page: Page, want: "personal" | string): Promise<string> {
  const { json: orgs } = await api<OrgRow[]>(page, "GET", "/api/organizations")
  const pick = want === "personal" ? orgs.find((o) => o.is_personal) : orgs.find((o) => o.id === want)
  expect(pick).toBeTruthy()
  expect((await api(page, "POST", "/api/organizations/switch", { organization_id: pick!.id })).status).toBe(200)
  await page.evaluate(() => { try { localStorage.removeItem("ps_active_org") } catch { /* private */ } })
  await page.goto("/dashboard"); await expectAppShell(page)
  return pick!.id
}
async function inFreshTab<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user.json" })
  const page = await context.newPage()
  try { await page.goto("/dashboard"); return await fn(page) } finally { await context.close() }
}
const overview = async (page: Page) => (await api<Overview>(page, "GET", "/api/debts")).json
const accounts = async (page: Page) => (await api<Account[]>(page, "GET", "/api/wealth/accounts")).json
const cashOf = async (page: Page) => Number((await accounts(page)).find((a) => a.type === "cash")!.current_balance)
const expenseOf = (rows: TxRow[]) => rows.reduce((s, t) => (!t.is_system && t.kind === "standard" && t.type === "outgoing" ? s + Number(t.amount) : s), 0)
const incomeOf = (rows: TxRow[]) => rows.reduce((s, t) => (!t.is_system && t.kind === "standard" && t.type === "incoming" ? s + Number(t.amount) : s), 0)
const cashRows = async (page: Page) => (await api<{ data: TxRow[] }>(page, "GET", `/api/transactions?wealthAccountId=${(await accounts(page)).find((a) => a.type === "cash")!.id}&page=1`)).json.data

const NAMES = { loan: `${E2E_PREFIX}-loan`, marco: `${E2E_PREFIX}-marco`, luca: `${E2E_PREFIX}-luca` }

async function cleanup(page: Page) {
  const o = await overview(page)
  const all = [...o.debts, ...o.receivables, ...((o as unknown as { closed: Debt[] }).closed ?? [])]
  for (const d of all.filter((x) => Object.values(NAMES).includes(x.name))) {
    const rows = (await api<{ data: TxRow[] }>(page, "GET", `/api/transactions?wealthAccountId=${d.id}&page=1`)).json.data
    if (rows.length) await api(page, "POST", "/api/transactions/bulk-delete", { ids: rows.map((r) => r.id) })
    await api(page, "POST", "/api/trash/clear")
    await api(page, "DELETE", `/api/debts/${d.id}`)
  }
}

test.describe.serial("Debt & Loans", () => {
  let restoreOrgId = ""
  let loanId = ""
  let marcoId = ""
  let lucaId = ""
  let cashStart = 0

  test.beforeAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      restoreOrgId = await page.evaluate(() => localStorage.getItem("ps_active_org") ?? "")
      orgIdForApi = await useWorkspace(page, "personal")
      await cleanup(page)
      cashStart = await cashOf(page)
    })
  })
  test.afterAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      orgIdForApi = await useWorkspace(page, "personal")
      await cleanup(page)
      if (restoreOrgId) await api(page, "POST", "/api/organizations/switch", { organization_id: restoreOrgId }).catch(() => {})
    })
  })

  test("empty state, then a quick informal debt through the UI", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page); await dismissBanners(page)
    await page.getByRole("button", { name: /add debt/i }).first().click()
    const dialog = page.getByRole("dialog", { name: /add debt/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("radio", { name: /^i owe$/i })).toHaveAttribute("aria-checked", "true")
    await dialog.getByLabel(/who do you owe/i).fill("Marco")
    await dialog.getByLabel(/name \(optional\)/i).fill(NAMES.marco)
    await dialog.getByLabel(/how much is left/i).fill("700")
    // Informal: no fixed payment → irregular.
    await dialog.getByRole("combobox", { name: /^every$/i }).click()
    await page.getByRole("option", { name: /irregular/i }).click()
    await dialog.getByRole("button", { name: /^add$/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    // Lands on the detail page.
    await expect(page.getByRole("heading", { name: NAMES.marco })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/^\D*700\.00$/).first()).toBeVisible()
    await expect(page.getByText(/no fixed payment/i)).toBeVisible()
    await expect(page.getByText(/no interest/i)).toBeVisible()
    const o = await overview(page)
    const marco = o.debts.find((d) => d.name === NAMES.marco)!
    marcoId = marco.id
    expect(marco.balance).toBe(700)
    expect(marco.estimate.kind).toBe("unknown") // no schedule → no invented date
    // Opening balance is a system row → no income, no expense.
    const rows = (await api<{ data: TxRow[] }>(page, "GET", `/api/transactions?wealthAccountId=${marcoId}&page=1`)).json.data
    expect(rows).toHaveLength(1); expect(rows[0].is_system).toBe(true)
  })

  test("borrowing into cash is a transfer: cash +5,000, debt 5,000, income 0", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page)
    const incomeBefore = incomeOf(await cashRows(page))
    const cashBefore = await cashOf(page)
    const cash = (await accounts(page)).find((a) => a.type === "cash")!
    const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
    const due = `${nextMonth.toISOString().slice(0, 8)}15`
    const created = await api<Debt>(page, "POST", "/api/debts", {
      direction: "owed", kind: "personal", counterparty: "E2E Bank", name: NAMES.loan, current_balance: 5000, original_amount: 5000,
      annual_rate_pct: 5, payment_amount: 438.71, payment_frequency: "monthly", next_due_date: due, disbursement_account_id: cash.id,
    })
    expect(created.status).toBe(201)
    loanId = created.json.id
    expect(await cashOf(page)).toBeCloseTo(cashBefore + 5000, 2)
    expect(created.json.balance).toBe(5000)
    expect(incomeOf(await cashRows(page))).toBe(incomeBefore) // borrowed money is NOT income
  })

  test("the debt screen shows the schedule and an estimated debt-free date", async ({ page }) => {
    await page.goto(`/debts/${loanId}`); await expectAppShell(page)
    await expect(page.getByText(/estimated debt-free/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: /^schedule$/i })).toBeVisible()
    await expect(page.getByText(/438\.71 every month/i)).toBeVisible()
    const d = (await overview(page)).debts.find((x) => x.id === loanId)!
    expect(d.estimate.kind).toBe("date")
  })

  test("record a payment with a known split: bank −500, principal −420, interest 70 + fees 10 are the only expenses", async ({ page }) => {
    await page.goto(`/debts/${loanId}`); await expectAppShell(page)
    const cashBefore = await cashOf(page)
    const expenseBefore = expenseOf(await cashRows(page))
    await page.getByRole("button", { name: /record payment/i }).first().click()
    const sheet = page.getByRole("dialog", { name: /record payment/i })
    await sheet.locator("#dp-total").fill("500")
    await sheet.getByRole("radio", { name: /i know the split/i }).click()
    await sheet.locator("#dp-principal").fill("420")
    await sheet.locator("#dp-interest").fill("70")
    await sheet.locator("#dp-fees").fill("10")
    await sheet.getByRole("button", { name: /^record payment$/i }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/^\D*4,580\.00$/).first()).toBeVisible({ timeout: 15_000 })
    expect(await cashOf(page)).toBeCloseTo(cashBefore - 500, 2)
    expect(expenseOf(await cashRows(page))).toBeCloseTo(expenseBefore + 80, 2)
    const o = await overview(page)
    expect(o.summary.month.paid).toBe(500)
    // Payment appears in history with its split.
    await expect(page.getByText(/principal \D*420\.00/i)).toBeVisible()
  })

  test("auto split uses the rate: one month of interest off the top, the rest principal", async ({ page }) => {
    await page.goto(`/debts/${loanId}`); await expectAppShell(page)
    const res = await api<{ payment: { principal: string; interest: string; split_source: string } }>(page, "POST", `/api/debts/${loanId}/payments`, {
      from_account_id: (await accounts(page)).find((a) => a.type === "cash")!.id, amount: 438.71, date: new Date().toISOString().slice(0, 10),
    })
    expect(res.status).toBe(201)
    // 4,580 × 5 % / 12 = 19.08 interest → 419.63 principal
    expect(Number(res.json.payment.interest)).toBe(19.08)
    expect(Number(res.json.payment.principal)).toBe(419.63)
    expect(res.json.payment.split_source).toBe("calculated")
    expect((await overview(page)).debts.find((d) => d.id === loanId)!.balance).toBe(4160.37)
  })

  test("deleting a payment reverses bank, principal and expenses together; Trash restore brings it all back once", async ({ page }) => {
    await page.goto(`/debts/${loanId}`); await expectAppShell(page)
    const payments = (await api<{ id: string; total: string; transaction_id: string }[]>(page, "GET", `/api/debts/${loanId}/payments`)).json
    const p500 = payments.find((p) => Number(p.total) === 500)!
    const cashBefore = await cashOf(page)
    const expenseBefore = expenseOf(await cashRows(page))
    expect((await api(page, "DELETE", `/api/debts/${loanId}/payments/${p500.id}`)).status).toBe(204)
    expect(await cashOf(page)).toBeCloseTo(cashBefore + 500, 2)
    expect(expenseOf(await cashRows(page))).toBeCloseTo(expenseBefore - 80, 2)
    expect((await overview(page)).debts.find((d) => d.id === loanId)!.balance).toBe(4580.37)
    // Restore from Trash via the anchor leg → the whole group comes back.
    expect((await api(page, "POST", "/api/trash/restore", { type: "transaction", id: p500.transaction_id })).status).toBe(200)
    expect(await cashOf(page)).toBeCloseTo(cashBefore, 2)
    expect(expenseOf(await cashRows(page))).toBeCloseTo(expenseBefore, 2)
    expect((await overview(page)).debts.find((d) => d.id === loanId)!.balance).toBe(4160.37)
  })

  test("the hub: total, this month, next payment, plan and upcoming tabs", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page)
    await expect(page.getByText(/total debt/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/4,860\.37/).first()).toBeVisible() // 4,160.37 + 700
    await expect(page.getByText(/next payment/i).first()).toBeVisible()
    await page.getByRole("tab", { name: /plan/i }).click()
    await expect(page.getByRole("radio", { name: /save the most interest/i })).toBeVisible()
    await expect(page.getByRole("radio", { name: /my own order/i })).toBeVisible()
    await page.getByRole("radio", { name: /fastest early wins/i }).click()
    await expect(page.getByRole("table")).toBeVisible()
    await page.getByRole("tab", { name: /upcoming/i }).click()
    await expect(page.getByText(new RegExp(NAMES.loan)).first()).toBeVisible()
  })

  test("owed to me: lending is a transfer out, a repayment comes back, no expense or income", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page)
    const cash = (await accounts(page)).find((a) => a.type === "cash")!
    const cashBefore = Number(cash.current_balance)
    const pnlBefore = { e: expenseOf(await cashRows(page)), i: incomeOf(await cashRows(page)) }
    const created = await api<Debt>(page, "POST", "/api/debts", { direction: "receivable", counterparty: "Luca", name: NAMES.luca, current_balance: 400, disbursement_account_id: cash.id })
    expect(created.status).toBe(201)
    lucaId = created.json.id
    expect(await cashOf(page)).toBeCloseTo(cashBefore - 400, 2)
    const rec = await api<{ debt: Debt }>(page, "POST", `/api/debts/${lucaId}/payments`, { from_account_id: cash.id, amount: 100, date: new Date().toISOString().slice(0, 10) })
    expect(rec.status).toBe(201)
    expect(rec.json.debt.balance).toBe(300)
    expect(await cashOf(page)).toBeCloseTo(cashBefore - 300, 2)
    expect(expenseOf(await cashRows(page))).toBeCloseTo(pnlBefore.e, 2)
    expect(incomeOf(await cashRows(page))).toBeCloseTo(pnlBefore.i, 2)
    await page.goto("/debts?tab=debts"); await expectAppShell(page)
    await expect(page.getByText(/owed to you/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test("net worth on /wealth includes loans as liabilities and receivables as assets", async ({ page }) => {
    await page.goto("/wealth"); await expectAppShell(page)
    await expect(page.getByText(/^owed:/i).first()).toBeVisible({ timeout: 15_000 })
    const cash = await cashOf(page)
    const expected = cash + 300 - 4160.37 - 700
    const text = await page.locator("p.text-3xl.font-bold").first().textContent()
    expect(Number(text!.replace(/[^\d.-]/g, ""))).toBeCloseTo(expected, 2)
  })

  test("mark paid off, close, and the cash account ends exactly where the payments left it", async ({ page }) => {
    await page.goto(`/debts/${marcoId}`); await expectAppShell(page)
    expect((await api(page, "PATCH", `/api/debts/${marcoId}`, { lifecycle: "paid_off" })).status).toBe(200)
    await page.reload(); await expectAppShell(page)
    await expect(page.getByText(/^\s*paid off\s*$/i).first()).toBeVisible({ timeout: 15_000 })
    // Cash moved by: +5000 (borrowed) −500 −438.71 (payments) −400 +100 (lent / repaid).
    expect(await cashOf(page)).toBeCloseTo(cashStart + 5000 - 500 - 438.71 - 400 + 100, 2)
  })
})
