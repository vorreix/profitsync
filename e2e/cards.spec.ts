import { expect, test, type Browser, type Page } from "@playwright/test"
import { E2E_PREFIX, dismissBanners, expectAppShell } from "./helpers"

/**
 * Wealth & Cards — end to end through the real UI, the real auth guard and the
 * real ledger. The accounting rules are pinned by DB-free unit tests
 * (src/lib/cards.test.ts, card-wizard.test.ts, credit-card*.test.ts); what only
 * a browser + database can prove is that the feature is wired together: the
 * Banks/Cards switcher and its URL, adding a debit card through the wizard,
 * paying with it from the normal Add-Transaction dialog, the "•••• 1234" chip
 * appearing in the transactions list, the card screen, freezing a card taking
 * it out of every picker, and the bank page listing its cards.
 *
 * WORKSPACE: the e2e user's PERSONAL workspace (no client picker), switched
 * back afterwards — playwright runs with `workers: 1`, so a leftover switch
 * would move every later spec's data into the wrong org.
 */

type OrgRow = { id: string; name: string; is_personal: boolean }
type Account = { id: string; type: string; nickname: string; bank_name: string; archived_at: string | null }
type CardRow = {
  id: string
  kind: "debit" | "credit"
  name: string
  last4: string
  status: string
  account_id: string
  account_bank_name?: string
}
type Tx = { id: string; description: string; card_id: string | null; wealth_account_id: string | null }

const CARD_NAME = `${E2E_PREFIX}-visa-debit`
const PURCHASE = `${E2E_PREFIX} card purchase`

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
 * The workspace every call in this spec targets. NEVER read from
 * `localStorage.ps_active_org` (the saved storage state carries the stale
 * business org): it is set once by `switchWorkspace` and sent explicitly, so a
 * request can never land in the wrong org no matter what the app is doing.
 */
let activeOrgId = ""

/** Call the app's own API with the page's real Clerk session, pinned to `activeOrgId`. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  await waitForClerk(page)
  return page.evaluate(
    async ({ method, path, body, orgId }) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
      const res = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(orgId ? { "x-org-id": orgId } : {}),
        },
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
  // Pin it for the API calls AND for the app the browser is about to boot.
  activeOrgId = pick!.id
  await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, pick!.id)
  return pick!.id
}

/** Switch AND reboot into a workspace, so the UI and the API calls agree. */
async function useWorkspace(page: Page, want: "personal" | string): Promise<string> {
  const id = await switchWorkspace(page, want)
  await page.goto("/dashboard")
  await expectAppShell(page)
  await page.waitForFunction((want) => localStorage.getItem("ps_active_org") === want, id, { timeout: 20_000 })
  return id
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

const cards = async (page: Page) => (await api<CardRow[]>(page, "GET", "/api/cards?includeClosed=1")).json
const accounts = async (page: Page) => (await api<Account[]>(page, "GET", "/api/wealth/accounts")).json

/** Remove anything a previous (aborted) run left behind. */
async function cleanup(page: Page) {
  for (const c of (await cards(page)).filter((x) => x.name.startsWith(E2E_PREFIX))) {
    const { json } = await api<{ data: Tx[] }>(page, "GET", `/api/transactions?cardId=${c.id}&page=1`)
    const ids = (json?.data ?? []).map((t) => t.id)
    if (ids.length) await api(page, "POST", "/api/transactions/bulk-delete", { ids })
    await api(page, "POST", "/api/trash/clear")
    if (c.status !== "active") await api(page, "PATCH", `/api/cards/${c.id}`, { status: "active" })
    const del = await api(page, "DELETE", `/api/cards/${c.id}`)
    console.log(`[cleanup] card ${c.name} → ${del.status}`)
  }
  for (const a of (await accounts(page)).filter((x) => (x.nickname || x.bank_name).startsWith(E2E_PREFIX))) {
    console.log(`[cleanup] account ${a.nickname || a.bank_name} → ${(await api(page, "DELETE", `/api/wealth/accounts/${a.id}`)).status}`)
  }
}

test.describe.serial("Wealth & Cards", () => {
  let restoreOrgId = ""
  let bankId = ""
  let bankName = ""
  let cardId = ""

  test.beforeAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      restoreOrgId = await page.evaluate(() => localStorage.getItem("ps_active_org") ?? "")
      await useWorkspace(page, "personal")
      expect(activeOrgId, "switched into the personal workspace").toBeTruthy()
      await cleanup(page)
      const bank = (await accounts(page)).find((a) => a.type === "bank" && !a.archived_at)
      expect(bank, "the personal workspace needs an active bank account").toBeTruthy()
      bankId = bank!.id
      bankName = bank!.nickname || bank!.bank_name
    })
  })

  // Every test gets a FRESH page from the saved storage state, whose
  // `ps_active_org` still points at the business workspace. Seed it before the
  // first navigation so the UI boots into the personal workspace the beforeAll
  // prepared (the API calls carry `x-org-id` for the same reason).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ }
    }, activeOrgId)
  })

  test.afterAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      await useWorkspace(page, "personal")
      await cleanup(page)
      if (restoreOrgId) await switchWorkspace(page, restoreOrgId).catch(() => {})
    })
  })

  test("the Banks/Cards switcher lives in the URL and keeps the page mounted", async ({ page }) => {
    await page.goto("/wealth")
    await expectAppShell(page)
    await dismissBanners(page)

    const tabs = page.getByRole("tablist")
    await expect(tabs).toBeVisible()
    const banksTab = page.getByRole("tab", { name: /banks/i })
    const cardsTab = page.getByRole("tab", { name: /cards/i })
    await expect(banksTab).toHaveAttribute("aria-selected", "true")

    // Switching writes ?tab=cards WITHOUT a remount (the tablist node survives).
    await tabs.evaluate((el) => el.setAttribute("data-e2e-mounted", "1"))
    await cardsTab.click()
    await expect(page).toHaveURL(/\?tab=cards/)
    await expect(cardsTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tablist")).toHaveAttribute("data-e2e-mounted", "1")

    // …and back, clearing the param.
    await banksTab.click()
    await expect(page).not.toHaveURL(/tab=cards/)
    await expect(banksTab).toHaveAttribute("aria-selected", "true")

    // The deep link redirects onto the same tab.
    await page.goto("/wealth/cards")
    await expect(page).toHaveURL(/\/wealth\?tab=cards/)
    await expect(page.getByRole("tab", { name: /cards/i })).toHaveAttribute("aria-selected", "true")
  })

  test("add a debit card through the wizard", async ({ page }) => {
    await page.goto("/wealth?tab=cards")
    await expectAppShell(page)
    await dismissBanners(page)

    await page.getByRole("button", { name: /add card/i }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    // Step 1 — what kind of card, and which bank it belongs to.
    await dialog.getByRole("radio", { name: /debit/i }).first().click()
    await dialog.getByRole("radio", { name: new RegExp(bankName.slice(0, 12), "i") }).first().click()
    await dialog.getByRole("button", { name: /^next$/i }).click()

    // Step 2 — the card's own details. All required except the nickname.
    await dialog.getByRole("radio", { name: /^visa$/i }).first().click()
    await dialog.getByLabel(/last 4/i).fill("4242")
    await dialog.getByLabel(/expiry/i).fill("0930")
    await dialog.getByLabel(/name on card/i).fill("E2E BOT")
    await dialog.getByLabel(/nickname/i).fill(CARD_NAME)
    await dialog.getByRole("button", { name: /^next$/i }).click()

    // Step 3 — look. Standard is preselected; save straight away.
    await expect(dialog.getByRole("radio", { name: /bank colours|bank colors/i })).toBeVisible()
    await dialog.getByRole("button", { name: /save card/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    const created = (await cards(page)).find((c) => c.name === CARD_NAME)
    expect(created, "the card was created").toBeTruthy()
    cardId = created!.id
    expect(created!.kind).toBe("debit")
    expect(created!.last4).toBe("4242")
    expect(created!.account_id).toBe(bankId)

    // The tile shows the card and what it spends from — never a card number.
    const tile = page.locator(`[data-card-tile="${cardId}"]`)
    await expect(tile).toBeVisible({ timeout: 15_000 })
    await expect(tile).toContainText("4242")
    await expect(tile).toContainText(new RegExp(bankName.slice(0, 12), "i"))
  })

  test("paying with the card attributes the transaction and shows the chip", async ({ page }) => {
    await page.goto("/transactions")
    await expectAppShell(page)
    await dismissBanners(page)
    // Fail loudly (not as a click timeout) if the previous test's card is not
    // in this workspace — the picker can only offer what /api/cards returns.
    const usable = (await cards(page)).filter((c) => c.status === "active")
    expect(usable.map((c) => c.name), "the debit card is available in this workspace").toContain(CARD_NAME)

    await page.getByRole("button", { name: /add transaction/i }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("radio", { name: /outgoing/i }).click()
    // Cash + one bank are pinned; everything else (the cards included) lives
    // behind the "+N more" reveal, which appears once the cards have loaded.
    await dialog.getByRole("button", { name: /\+\d+ more/i }).click()
    await dialog.getByRole("button", { name: new RegExp(CARD_NAME, "i") }).first().click()
    await dialog.getByPlaceholder("0.00").first().fill("25")
    await dialog.locator("textarea").first().fill(PURCHASE)
    await dialog.getByRole("button", { name: /^add$/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    // The row carries the card, and the money left the card's BANK.
    const { json } = await api<{ data: Tx[] }>(page, "GET", `/api/transactions?cardId=${cardId}&page=1`)
    const row = json.data.find((t) => t.description === PURCHASE)
    expect(row, "the purchase is on the card").toBeTruthy()
    expect(row!.card_id).toBe(cardId)
    expect(row!.wealth_account_id).toBe(bankId)

    // …and the list row shows "Debit •••• 4242" instead of the bank name.
    await page.reload()
    await expectAppShell(page)
    const listRow = page.locator("div").filter({ hasText: PURCHASE }).filter({ hasText: "4242" }).last()
    await expect(listRow).toBeVisible({ timeout: 15_000 })
  })

  test("the card screen shows the card and its activity", async ({ page }) => {
    await page.goto(`/wealth/cards/${cardId}`)
    await expectAppShell(page)
    await dismissBanners(page)

    await expect(page.getByRole("heading", { name: new RegExp(CARD_NAME, "i") })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("4242").first()).toBeVisible()
    // Linked bank + the purchase we just made.
    await expect(page.getByText(new RegExp(bankName.slice(0, 12), "i")).first()).toBeVisible()
    await expect(page.getByText(PURCHASE).first()).toBeVisible({ timeout: 15_000 })
  })

  test("freezing a card takes it out of the pickers and refuses new purchases", async ({ page }) => {
    // Load the app first: `api()` runs inside the page and needs a live Clerk session.
    await page.goto("/transactions")
    await expectAppShell(page)
    await dismissBanners(page)

    const frozen = await api(page, "PATCH", `/api/cards/${cardId}`, { status: "frozen" })
    expect(frozen.status).toBe(200)

    // The server is the boundary.
    const refused = await api<{ error?: string }>(page, "POST", "/api/transactions/group", {
      type: "outgoing",
      allocations: [{ card_id: cardId, amount: 5 }],
    })
    expect(refused.status).toBe(400)
    expect(refused.json.error ?? "").toMatch(/frozen/i)

    // …and the picker no longer offers it (reload so the card list is refetched).
    await page.reload()
    await expectAppShell(page)
    await dismissBanners(page)
    await page.getByRole("button", { name: /add transaction/i }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: new RegExp(CARD_NAME, "i") })).toHaveCount(0)
    await page.keyboard.press("Escape")

    await api(page, "PATCH", `/api/cards/${cardId}`, { status: "active" })
  })

  test("the bank page keeps its cards behind the header button, grouped by relationship", async ({ page }) => {
    await page.goto(`/wealth/${bankId}`)
    await expectAppShell(page)
    await dismissBanners(page)

    // The cards are NOT in the page body any more — they live behind the
    // header's card button, so the account's own content keeps the space.
    await expect(page.locator(`[data-card-tile="${cardId}"]`)).toHaveCount(0)

    await page.getByRole("button", { name: /cards on this account/i }).click()
    const sheet = page.locator("#cards")
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    // A debit card belongs to the account it spends from — never the group for
    // credit cards this account merely pays.
    await expect(sheet.getByText(/on this account/i).first()).toBeVisible()
    await expect(sheet.locator(`[data-card-tile="${cardId}"]`)).toBeVisible()
  })

  test("the #cards deep link opens the same overlay", async ({ page }) => {
    await page.goto(`/wealth/${bankId}#cards`)
    // No expectAppShell here on purpose: the deep link opens the overlay as
    // soon as the page boots, and Radix marks everything behind a modal
    // aria-hidden — so the shell's own nav links are gone from the
    // accessibility tree by the time that helper would look for them. The
    // overlay being visible with the right card in it proves the app booted.
    await expect(page.locator("#cards")).toBeVisible({ timeout: 20_000 })
    await expect(page.locator("#cards").locator(`[data-card-tile="${cardId}"]`)).toBeVisible()
  })
})
