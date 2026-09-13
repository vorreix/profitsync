import { expect, test, type Browser, type Page } from "@playwright/test"
import { E2E_PREFIX, dismissBanners, ensureBank, expectAppShell } from "./helpers"

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
const rowsOf = async (page: Page, accountId: string) => (await api<{ data: TxRow[] }>(page, "GET", `/api/transactions?wealthAccountId=${accountId}&page=1`)).json.data

const NAMES = { loan: `${E2E_PREFIX}-loan`, marco: `${E2E_PREFIX}-marco`, luca: `${E2E_PREFIX}-luca`, auto: `${E2E_PREFIX}-auto`, partial: `${E2E_PREFIX}-partial` }

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
    await dialog.getByLabel(/who do you owe/i).fill(NAMES.marco)
    await dialog.getByLabel(/how much is left/i).fill("700")
    // The default is "I'll record payments myself" — an informal debt has no
    // schedule, so nothing is set up and no date can be estimated.
    await expect(dialog.getByRole("radio", { name: /record payments myself/i })).toHaveAttribute("aria-checked", "true")
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
    // Pick the paying account EXPLICITLY. The sheet defaults to the first bank
    // (or whichever account is marked default), so a workspace that happens to
    // have a bank sends the money from there and the cash assertions below fail
    // for a reason that has nothing to do with debts.
    const cashName = (await accounts(page)).find((a) => a.type === "cash")!.nickname || "Cash in Hand"
    await sheet.getByRole("combobox").first().click()
    const picker = page.locator("[data-slot=popover-content]")
    await expect(picker).toBeVisible({ timeout: 10_000 })
    await picker.getByPlaceholder(/search accounts/i).fill(cashName)
    // The rows are plain buttons, not listbox options.
    await picker.getByRole("button", { name: new RegExp(cashName, "i") }).first().click()
    await expect(picker).toBeHidden({ timeout: 10_000 })
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
    // The payment appears in Activity with what came off the debt (420) and what
    // it actually cost on top (70 interest + 10 fees).
    await expect(page.getByRole("heading", { name: /^activity/i })).toBeVisible()
    await expect(page.getByText(/420\.00/).first()).toBeVisible()
    await expect(page.getByText(/interest \D*80\.00/i).first()).toBeVisible()
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

  test("a partial disbursement adds up: what arrives is a transfer, the rest is an opening balance", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page)
    // A dedicated BANK, never cash: the last test in this spec audits the cash
    // account across the WHOLE suite, so money moved here would break an
    // assertion that has nothing to do with disbursements.
    const bank = await ensureBank(page, api)
    const bankBefore = Number((await accounts(page)).find((a) => a.id === bank.id)!.current_balance)
    const incomeBefore = incomeOf(await rowsOf(page, bank.id))

    // Borrow 1,000; only 600 reaches the account. You owe 1,000 either way.
    const created = await api<{ id: string }>(page, "POST", "/api/debts", {
      direction: "owed", name: NAMES.partial, current_balance: 1000, original_amount: 1000,
      disbursement_account_id: bank.id, disbursement_amount: 600,
    })
    expect(created.status).toBe(201)
    const id = created.json.id

    type Detail = { debt: Debt; activity: { kind: string; principal: number }[] }
    const d = (await api<Detail>(page, "GET", `/api/debts/${id}`)).json
    expect(d.debt.balance).toBe(1000)
    expect(Number((await accounts(page)).find((a) => a.id === bank.id)!.current_balance)).toBeCloseTo(bankBefore + 600, 2)
    expect(incomeOf(await rowsOf(page, bank.id))).toBe(incomeBefore) // still never income

    // Two events, and they account for the whole debt: 600 borrowed, 400 already owed.
    const borrow = d.activity.find((a) => a.kind === "borrow")!
    const opening = d.activity.find((a) => a.kind === "opening")!
    expect(borrow.principal).toBe(-600)
    expect(opening.principal).toBe(-400)
    expect(d.activity.reduce((s, a) => s + a.principal, 0)).toBe(-1000)

    // More arriving than the debt itself is refused.
    const tooMuch = await api(page, "POST", "/api/debts", {
      direction: "owed", name: `${NAMES.partial}-bad`, current_balance: 100,
      disbursement_account_id: bank.id, disbursement_amount: 500,
    })
    expect(tooMuch.status).toBe(400)
  })

  test("global search finds a debt in its own group, never as a bank account", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page)
    type Results = { accounts: { id: string; type: string }[]; debts: { id: string; name: string; direction: string }[] }
    const res = await api<Results>(page, "GET", `/api/search?q=${encodeURIComponent(NAMES.loan)}`)
    expect(res.status).toBe(200)
    expect(res.json.debts.some((d) => d.id === loanId)).toBe(true)
    // …and it must NOT leak into the accounts group, which links to /wealth/:id.
    expect(res.json.accounts.some((a) => a.id === loanId)).toBe(false)
  })

  test("a recurring repayment posts itself: principal is a transfer, interest is the only expense, and it stops when the debt does", async ({ page }) => {
    await page.goto("/debts"); await expectAppShell(page)
    // The BANK again, never cash — see the partial-disbursement test above.
    const bank = await ensureBank(page, api)
    const bankBefore = Number((await accounts(page)).find((a) => a.id === bank.id)!.current_balance)
    const expenseBefore = expenseOf(await rowsOf(page, bank.id))
    const today = new Date().toISOString().slice(0, 10)

    // 600 owed at 12 %, repaying 250 a month starting today: the first
    // instalment posts on create, and the third has to be CAPPED at the payoff
    // figure or the balance sails past zero into invisible credit.
    const created = await api<{ id: string }>(page, "POST", "/api/debts", {
      direction: "owed", name: NAMES.auto, kind: "Chit fund", current_balance: 600, original_amount: 600,
      annual_rate_pct: 12,
      repayment: { enabled: true, from_account_id: bank.id, amount: 250, frequency: "monthly", start_date: today },
    })
    expect(created.status).toBe(201)
    const autoId = created.json.id

    type Detail = {
      debt: Debt & { payment_amount: number | null; next_due_date: string | null; kind: string }
      repayment: { id: string; active: boolean; amount: number; frequency: string; from_account_id: string } | null
      activity: { kind: string; principal: number; interest: number; recurring_rule_id: string | null }[]
    }
    const detail = async () => (await api<Detail>(page, "GET", `/api/debts/${autoId}`)).json
    let d = await detail()

    // The rule exists, is linked, and IS the debt's schedule.
    expect(d.repayment).toBeTruthy()
    expect(d.repayment!.amount).toBe(250)
    expect(d.repayment!.frequency).toBe("monthly")
    expect(d.repayment!.from_account_id).toBe(bank.id)
    expect(d.debt.payment_amount).toBe(250)
    expect(d.debt.kind).toBe("Chit fund") // free text survives the round trip

    // The first instalment posted: 600 × 12 %/12 = 6.00 interest, 244 principal.
    const first = d.activity.find((a) => a.kind === "payment")!
    expect(first.interest).toBe(6)
    expect(first.principal).toBe(244)
    expect(first.recurring_rule_id).toBe(d.repayment!.id)
    expect(d.debt.balance).toBe(356)
    expect(Number((await accounts(page)).find((a) => a.id === bank.id)!.current_balance)).toBeCloseTo(bankBefore - 250, 2)
    // Only the interest is spending — 6.00, not the 250 that left the account.
    // The 244 of principal is a transfer, so net worth did not move by it.
    const payerRows = await rowsOf(page, bank.id)
    expect(expenseOf(payerRows)).toBeCloseTo(expenseBefore + 6, 2)
    expect(payerRows.some((r) => r.kind === "transfer" && r.type === "outgoing" && Number(r.amount) === 244)).toBe(true)

    // Re-reading must not post it twice.
    const again = await detail()
    expect(again.debt.balance).toBe(356)
    expect(again.activity.filter((a) => a.kind === "payment")).toHaveLength(1)

    // Pausing the debt stops the rule dead.
    expect((await api(page, "PATCH", `/api/debts/${autoId}`, { lifecycle: "paused" })).status).toBe(200)
    d = await detail()
    expect(d.repayment!.active).toBe(false)
    // Resuming re-anchors to today rather than back-paying the holiday.
    expect((await api(page, "PATCH", `/api/debts/${autoId}`, { lifecycle: "active" })).status).toBe(200)
    d = await detail()
    expect(d.repayment!.active).toBe(true)

    // A hand-recorded payment alongside a live rule is an EXTRA one: the next
    // due date must not move, or the instalment the user still expects is
    // silently cancelled.
    const dueBefore = d.debt.next_due_date
    expect((await api(page, "POST", `/api/debts/${autoId}/payments`, { from_account_id: bank.id, amount: 50, date: today })).status).toBe(201)
    d = await detail()
    expect(d.debt.next_due_date).toBe(dueBefore)

    // Closing the debt stops the rule too — a closed debt that kept taking money
    // every month is the worst version of this bug.
    expect((await api(page, "DELETE", `/api/debts/${autoId}`)).status).toBe(200)
    expect((await detail()).repayment!.active).toBe(false)
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

    // Computed from the API, not hardcoded: this workspace is shared and carries
    // whatever other branches and runs have left in it, so "net worth == cash
    // plus these debts" only ever held on an empty database. What is actually
    // being asserted is the CLAIM — a loan comes off net worth, a receivable
    // goes on — and that holds whatever else the workspace contains.
    const spendable = (await accounts(page)).filter((a) => !a.archived_at)
      .reduce((sum, a) => sum + Number(a.current_balance), 0)
    const spaces = (await api<Account[]>(page, "GET", "/api/spaces")).json ?? []
    const saved = spaces.filter((s) => !s.archived_at).reduce((sum, s) => sum + Number(s.current_balance), 0)
    const o = await overview(page)
    // The workspace currency, from the API — NOT a hardcoded one. Only debts in
    // it join net worth (no exchange rate is invented), and this workspace is
    // not necessarily in euros.
    const sameCurrency = (xs: { currency: string; amount: number }[] | undefined) =>
      (xs ?? []).filter((x) => x.currency === o.currency).reduce((sum, x) => sum + x.amount, 0)
    const expected = spendable + saved + sameCurrency(o.summary.receivable_by_currency) - sameCurrency(o.summary.owed_by_currency)

    const text = await page.locator("p.text-3xl.font-bold").first().textContent()
    expect(Number(text!.replace(/[^\d.-]/g, ""))).toBeCloseTo(expected, 2)
    // And the debts really are in there: drop them and the figure would differ.
    expect(sameCurrency(o.summary.owed_by_currency)).toBeGreaterThan(0)
  })

  test("mark paid off, close, and the cash account ends exactly where the payments left it", async ({ page }) => {
    await page.goto(`/debts/${marcoId}`); await expectAppShell(page)
    expect((await api(page, "PATCH", `/api/debts/${marcoId}`, { lifecycle: "paid_off" })).status).toBe(200)
    await page.reload(); await expectAppShell(page)
    await expect(page.getByText(/^\s*paid off\s*$/i).first()).toBeVisible({ timeout: 15_000 })
    // Cash moved by: +5000 (borrowed) −500 −438.71 (payments) −400 +100 (lent / repaid).
    //
    // This is a ledger of EVERY cash movement the spec makes, which is the
    // point: it proves the whole feature's money adds up rather than each
    // operation in isolation. A new test that touches cash must be added to
    // this sum — or, better, use ensureBank() and leave cash alone, which is
    // what the disbursement and recurring tests above do.
    expect(await cashOf(page)).toBeCloseTo(cashStart + 5000 - 500 - 438.71 - 400 + 100, 2)
  })
})
