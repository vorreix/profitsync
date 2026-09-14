import { expect, test, type Page } from "@playwright/test"
import { E2E_PREFIX, dismissBanners, ensureBank, expectAppShell, rememberWorkspace, restoreWorkspace, switchWorkspace } from "./helpers"

/**
 * Creating a debt from the RECURRING side, through the real UI.
 *
 * The unit tests pin the predicate and the previews, and `debts.spec.ts` covers
 * the debt side. Neither can catch the failure this file exists for: the dialog
 * silently deciding the answer to "does this pay a debt?" is no, and saving a
 * plain expense instead — the rule is created, the save succeeds, the toast is
 * green, and the debt the user asked for simply is not there. Nothing short of
 * driving the form and then looking in the database sees it.
 *
 * Runs in the e2e user's PERSONAL workspace and removes what it makes.
 */

type Rule = { id: string; name: string; kind?: string; debt_account_id?: string | null; category: string; frequency_unit: string; frequency_interval: number; amount: string | number }
type Debt = { id: string; name: string; balance: number; original_amount?: number | null; annual_rate_pct?: number | null; payment_amount?: number | null; payment_frequency?: string | null; repayment_linked?: boolean }
type Overview = { debts: Debt[]; receivables: Debt[]; closed?: Debt[] }
type TxRow = { id: string }

let orgIdForApi = ""
// The workspace the user was in before this file ran. The active workspace is
// SHARED state on the server, so leaving it switched changes what every later
// spec sees — it is what turned off /clients and broke smoke's "create a client".
let restoreOrgId = ""

const RULE_NAME = `${E2E_PREFIX}-from-recurring`
const DEBT_NAME = `${E2E_PREFIX}-inline-debt`

/**
 * The modal — NOT `getByRole("dialog")`.
 *
 * Radix gives a popover `role="dialog"` too, and it stays mounted through its
 * exit animation, so the moment this form's account combobox has been opened
 * once, `getByRole("dialog")` can resolve to two elements and every assertion on
 * it dies of a strict-mode violation instead of the thing it was checking.
 * `data-slot` is what actually distinguishes them, and it is not translated.
 */
const modal = (page: Page) => page.locator('[data-slot="dialog-content"]')

async function waitForClerk(page: Page) {
  await page.waitForFunction(
    () => { const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk; return !!c?.loaded && !!c.session },
    null,
    { timeout: 30_000 },
  )
}

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await waitForClerk(page)
  return page.evaluate(async ({ method, path, body, orgId }) => {
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
  }, { method, path, body, orgId: orgIdForApi })
}

const overview = async (page: Page) => (await api<Overview>(page, "GET", "/api/debts")).json
const rules = async (page: Page) => (await api<Rule[]>(page, "GET", "/api/recurring")).json

async function cleanup(page: Page) {
  for (const r of (await rules(page)).filter((x) => x.name.startsWith(E2E_PREFIX))) {
    await api(page, "DELETE", `/api/recurring/${r.id}`)
  }
  const o = await overview(page)
  for (const d of [...o.debts, ...o.receivables, ...(o.closed ?? [])].filter((x) => x.name.startsWith(E2E_PREFIX))) {
    const { json } = await api<{ data: TxRow[] }>(page, "GET", `/api/transactions?wealthAccountId=${d.id}&page=1`)
    if (json?.data?.length) await api(page, "POST", "/api/transactions/bulk-delete", { ids: json.data.map((t) => t.id) })
    await api(page, "POST", "/api/trash/clear")
    await api(page, "DELETE", `/api/debts/${d.id}`)
  }
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: "e2e/.auth/user.json" })).newPage()
  await page.goto("/dashboard")
  await expectAppShell(page)
  restoreOrgId = await rememberWorkspace(page, api)
  orgIdForApi = await switchWorkspace(page, api, "personal")
  await cleanup(page)
  await page.context().close()
})

test.afterAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: "e2e/.auth/user.json" })).newPage()
  await page.goto("/dashboard")
  await expectAppShell(page)
  await cleanup(page)
  // Put the workspace back before anything else runs. Without this the user is
  // left in the personal workspace, where /clients and /quotations do not exist.
  await restoreWorkspace(page, api, restoreOrgId)
  await page.context().close()
})

/** Open the Add dialog on /recurring, with the account list already loaded. */
async function openAddDialog(page: Page) {
  await page.goto("/recurring")
  await expectAppShell(page)
  await dismissBanners(page)
  await page.getByRole("button", { name: /add recurring|^new$/i }).first().click()
  await expect(modal(page)).toBeVisible()
  await expect(page.locator("#rec-name")).toBeVisible()
}

test("a new recurring payment can create the debt it pays, in one save", async ({ page }) => {
  await page.goto("/dashboard")
  await expectAppShell(page)
  const bank = await ensureBank(page, api)

  await openAddDialog(page)
  const dialog = modal(page)

  await dialog.locator("#rec-name").fill(RULE_NAME)
  await dialog.locator("#rec-amount").fill("250")
  // Well clear of today so nothing materialises while the test runs.
  await dialog.locator("#rec-start").fill("2028-03-01")

  // Pay with → the bank. The debt question only offers "create one" once the
  // payer can actually service a debt, so this has to come first.
  await dialog.getByRole("combobox").filter({ hasText: /no account|bank|cash/i }).first().click()
  await page.getByRole("option", { name: new RegExp(bank.nickname || bank.bank_name, "i") }).first()
    .or(page.getByText(bank.nickname || bank.bank_name, { exact: false }).first())
    .click()
  await expect(dialog.getByText(new RegExp(bank.nickname || bank.bank_name, "i")).first()).toBeVisible()

  // "Does this pay a debt?" → create one.
  await dialog.locator("#rec-debt").click()
  const createOption = page.getByRole("option", { name: /create a new one/i })
  await expect(createOption, "the create-a-debt option is offered once a bank is chosen").toBeVisible()
  await createOption.click()

  await expect(dialog.locator("#rec-debt-name")).toBeVisible()
  await dialog.locator("#rec-debt-name").fill(DEBT_NAME)
  await dialog.locator("#rec-debt-original").fill("12000")
  await dialog.locator("#rec-debt-balance").fill("9000")
  // The rate is a loan-document fact, so it lives behind "More details".
  await dialog.getByRole("button", { name: /more details/i }).click()
  await dialog.locator("#rec-debt-rate").fill("5")

  // The debt question must still say "create one" at the moment of saving —
  // this is the exact state that was being silently reset.
  await expect(dialog.locator("#rec-debt")).toContainText(/create a new one/i)

  await dialog.getByRole("button", { name: /add recurring|save/i }).last().click()
  await expect(modal(page)).toBeHidden({ timeout: 15_000 })

  // ── The debt exists ──────────────────────────────────────────────────────
  const o = await overview(page)
  const debt = [...o.debts, ...o.receivables].find((d) => d.name === DEBT_NAME)
  expect(debt, "the debt the form was told to create actually exists").toBeTruthy()
  expect(debt!.balance).toBeCloseTo(9000, 2)
  expect(Number(debt!.annual_rate_pct)).toBeCloseTo(5, 4)
  // What it STARTED at, so "25% repaid" is true rather than every debt made
  // here being born at zero against its own remaining balance.
  expect(Number(debt!.original_amount)).toBeCloseTo(12000, 2)

  // ── And the rule is its repayment, not a plain expense ───────────────────
  const rule = (await rules(page)).find((r) => r.name === RULE_NAME)
  expect(rule, "the recurring payment exists").toBeTruthy()
  expect(rule!.kind, "it is a debt repayment, not a standard expense").toBe("debt")
  expect(rule!.debt_account_id).toBe(debt!.id)
  expect(rule!.category, "a repayment's category is the engine's").toBe("Transfer")

  // ── And the debt mirrors the rule's schedule ─────────────────────────────
  expect(Number(debt!.payment_amount)).toBeCloseTo(250, 2)
  expect(debt!.repayment_linked).toBeTruthy()
})

test("an unnameable rhythm survives the round trip", async ({ page }) => {
  // "Every 2 years" has no word in the debt vocabulary. Naming the nearest one
  // turned it into "monthly" and took the money twenty-four times as often.
  await page.goto("/dashboard")
  await expectAppShell(page)
  const bank = await ensureBank(page, api)
  await cleanup(page)

  await openAddDialog(page)
  const dialog = modal(page)

  await dialog.locator("#rec-name").fill(RULE_NAME)
  await dialog.locator("#rec-amount").fill("5000")
  await dialog.locator("#rec-start").fill("2028-03-01")
  await dialog.locator("#rec-interval").fill("2")

  // Repeats → Years.
  await dialog.getByRole("combobox").first().click()
  await page.getByRole("option", { name: /^years?$/i }).click()

  await dialog.getByRole("combobox").filter({ hasText: /no account|bank|cash/i }).first().click()
  await page.getByText(bank.nickname || bank.bank_name, { exact: false }).first().click()

  await dialog.locator("#rec-debt").click()
  await page.getByRole("option", { name: /create a new one/i }).click()
  await dialog.locator("#rec-debt-name").fill(DEBT_NAME)
  await dialog.locator("#rec-debt-balance").fill("40000")

  await dialog.getByRole("button", { name: /add recurring|save/i }).last().click()
  await expect(modal(page)).toBeHidden({ timeout: 15_000 })

  const rule = (await rules(page)).find((r) => r.name === RULE_NAME)
  expect(rule, "the recurring payment exists").toBeTruthy()
  expect(rule!.frequency_unit, "the rhythm the user chose").toBe("year")
  expect(Number(rule!.frequency_interval)).toBe(2)

  const debt = [...(await overview(page)).debts].find((d) => d.name === DEBT_NAME)
  expect(debt, "the debt exists").toBeTruthy()
  // No word for it — and the debt says so rather than rounding to "monthly".
  expect(debt!.payment_frequency).toBe("irregular")
})

test("the reported shape: starts today, monthly, straight from a bank", async ({ page }) => {
  // The exact rule the user reported as "the debt object is not created": a
  // monthly payment starting TODAY, paid from a bank, with a debt created
  // inline. Starting today means it materialises during the save, which is the
  // one thing the other two cases do not exercise.
  await page.goto("/dashboard")
  await expectAppShell(page)
  const bank = await ensureBank(page, api)
  await cleanup(page)

  const today = new Date().toISOString().slice(0, 10)
  await openAddDialog(page)
  const dialog = modal(page)

  await dialog.locator("#rec-name").fill(RULE_NAME)
  await dialog.locator("#rec-amount").fill("100")
  await dialog.locator("#rec-start").fill(today)

  await dialog.getByRole("combobox").filter({ hasText: /no account|bank|cash/i }).first().click()
  await page.getByText(bank.nickname || bank.bank_name, { exact: false }).first().click()

  await dialog.locator("#rec-debt").click()
  await page.getByRole("option", { name: /create a new one/i }).click()
  await dialog.locator("#rec-debt-name").fill(DEBT_NAME)
  await dialog.locator("#rec-debt-balance").fill("5000")

  await dialog.getByRole("button", { name: /add recurring|save/i }).last().click()
  await expect(modal(page)).toBeHidden({ timeout: 15_000 })

  const debt = [...(await overview(page)).debts].find((d) => d.name === DEBT_NAME)
  expect(debt, "the debt exists even when the first instalment posts on the spot").toBeTruthy()
  const rule = (await rules(page)).find((r) => r.name === RULE_NAME)
  expect(rule!.kind).toBe("debt")
  expect(rule!.debt_account_id).toBe(debt!.id)
})

test("the debt answer survives the page revalidating underneath the open dialog", async ({ page }) => {
  // /api/recurring is ALWAYS_FETCH and revalidates in the background, which
  // re-renders the parent with a fresh accounts array. That churn feeds the
  // eligibility predicate, and the effect that drops an ineligible debt choice
  // listens to it — so a refresh landing mid-form must not quietly answer
  // "no debt" on the user's behalf.
  await page.goto("/dashboard")
  await expectAppShell(page)
  const bank = await ensureBank(page, api)
  await cleanup(page)

  await openAddDialog(page)
  const dialog = modal(page)
  await dialog.locator("#rec-name").fill(RULE_NAME)
  await dialog.locator("#rec-amount").fill("100")
  await dialog.locator("#rec-start").fill("2028-05-01")
  await dialog.getByRole("combobox").filter({ hasText: /no account|bank|cash/i }).first().click()
  await page.getByText(bank.nickname || bank.bank_name, { exact: false }).first().click()
  await dialog.locator("#rec-debt").click()
  await page.getByRole("option", { name: /create a new one/i }).click()
  await dialog.locator("#rec-debt-name").fill(DEBT_NAME)
  await dialog.locator("#rec-debt-balance").fill("5000")

  // Force exactly what a background revalidation does to the parent.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ps:data-changed")))
  await page.waitForTimeout(1500)

  await expect(dialog.locator("#rec-debt"), "the answer is still 'create one'").toContainText(/create a new one/i)
  await expect(dialog.locator("#rec-debt-name")).toHaveValue(DEBT_NAME)

  await dialog.getByRole("button", { name: /add recurring|save/i }).last().click()
  await expect(modal(page)).toBeHidden({ timeout: 15_000 })
  expect([...(await overview(page)).debts].find((d) => d.name === DEBT_NAME)).toBeTruthy()
})

test("a category is required for an ordinary payment, and not asked for a repayment", async ({ page }) => {
  // A recurring rule stamps its category onto every occurrence it will ever
  // post, and a blank one is unreachable by every category-scoped budget.
  await page.goto("/dashboard")
  await expectAppShell(page)
  const bank = await ensureBank(page, api)
  await cleanup(page)

  await openAddDialog(page)
  const dialog = modal(page)
  await dialog.locator("#rec-name").fill(RULE_NAME)
  await dialog.locator("#rec-amount").fill("40")
  await dialog.locator("#rec-start").fill("2028-06-01")
  await dialog.getByRole("combobox").filter({ hasText: /no account|bank|cash/i }).first().click()
  await page.getByText(bank.nickname || bank.bank_name, { exact: false }).first().click()

  // No category → refused, and the dialog stays open with everything intact.
  await dialog.getByRole("button", { name: /add recurring|save/i }).last().click()
  await expect(modal(page)).toBeVisible()
  await expect(dialog.getByText(/choose a category/i).first()).toBeVisible()
  expect((await rules(page)).find((r) => r.name === RULE_NAME), "nothing was created").toBeFalsy()

  // Answering the debt question retires the requirement: a repayment's
  // category belongs to the engine, and the picker is not even rendered.
  await dialog.locator("#rec-debt").click()
  await page.getByRole("option", { name: /create a new one/i }).click()
  await dialog.locator("#rec-debt-name").fill(DEBT_NAME)
  await dialog.locator("#rec-debt-balance").fill("800")
  await dialog.getByRole("button", { name: /add recurring|save/i }).last().click()
  await expect(modal(page)).toBeHidden({ timeout: 15_000 })

  const rule = (await rules(page)).find((r) => r.name === RULE_NAME)
  expect(rule!.category, "the engine's category, not the form's").toBe("Transfer")
})

test("dismissing the dialog keeps what was typed; Cancel and saving do not", async ({ page }) => {
  await page.goto("/dashboard")
  await expectAppShell(page)
  await ensureBank(page, api)
  await cleanup(page)

  await openAddDialog(page)
  const dialog = modal(page)
  await dialog.locator("#rec-name").fill(RULE_NAME)
  await dialog.locator("#rec-amount").fill("123")

  // Escape is an accident, not a decision.
  await page.keyboard.press("Escape")
  await expect(modal(page)).toBeHidden()
  await page.getByRole("button", { name: /add recurring|^new$/i }).first().click()
  await expect(dialog.locator("#rec-name")).toHaveValue(RULE_NAME)
  await expect(dialog.locator("#rec-amount")).toHaveValue("123")

  // Cancel is a decision.
  await dialog.getByRole("button", { name: /^cancel$/i }).click()
  await expect(modal(page)).toBeHidden()
  await page.getByRole("button", { name: /add recurring|^new$/i }).first().click()
  await expect(dialog.locator("#rec-name")).toHaveValue("")
  await expect(dialog.locator("#rec-amount")).toHaveValue("")
  await page.keyboard.press("Escape")
})
