import { neon } from "@neondatabase/serverless"
import { expect, test, type Page } from "@playwright/test"
import { E2E_PREFIX, MC_ORG_PREFIX, expectAppShell, rememberWorkspace, restoreWorkspace, switchWorkspace } from "./helpers"

/**
 * Multi-currency, end to end on the real app: a EUR account and an INR account
 * in one workspace, a cross-currency transfer with a fee, and the consolidated
 * picture the user actually reads.
 *
 * What it pins (the invariants a wrong number would break):
 *   • an account's NATIVE balance never moves because a rate moved;
 *   • a cross-currency transfer keeps BOTH native amounts and its own rate;
 *   • the fee is the ONLY expense, and the only economic loss;
 *   • income and expense do not count a transfer;
 *   • consolidated net worth = converted assets − converted liabilities, and
 *     says which currencies it had to leave out rather than pretending 1:1.
 *
 * It runs in a THROWAWAY business workspace made for this run, reporting in
 * EUR, and deleted in afterAll — the org teardown takes its accounts, transfers
 * and every row with it (MC-122; leftovers from an interrupted run are swept by
 * auth.setup.ts). A fresh ledger means the reversal really runs every time, and
 * a fixed reporting currency makes the fee exact (MC-175).
 */

type Account = { id: string; type: string; bank_name: string; nickname: string; currency_code?: string | null; current_balance: string; archived_at: string | null }
type Summary = {
  reporting_currency: string
  net_worth: number
  assets: number
  liabilities: number
  complete: boolean
  excluded_currencies: string[]
  multi_currency: boolean
  by_currency: { currency: string; assets: number; converted_assets: number | null; rate: string | null; share: number | null }[]
  accounts: { id: string; currency: string; native_balance: number; converted_balance: number | null; rate: string | null }[]
}
type Tx = { id: string; kind: string; type: string; amount: string; currency_code?: string | null; description: string; category: string; transfer_id?: string | null }
type TxSummary = { currency: string; summary: { incoming: number; outgoing: number; currency: string; excluded_count: number } }
type Transfer = { id: string; status: string; source_amount: string; destination_amount: string; source_currency: string; destination_currency: string; effective_rate: string | null; source_fee_amount: string }

// Cash wallets, not banks: the free plan includes exactly ONE bank, and this is
// the case the brief actually describes — cash in EUR and cash in INR side by
// side (mig 0069 lifted the one-cash-wallet rule for exactly this reason).
const EUR_BANK = `${E2E_PREFIX}-mc-eur`
const INR_BANK = `${E2E_PREFIX}-mc-inr`

let activeOrgId = ""

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

// `asOldBuild` leaves out the capability header every current client sends
// (src/lib/client-capabilities.ts), to act like a store-pinned build.
async function api<T>(page: Page, method: string, path: string, body?: unknown, asOldBuild = false): Promise<{ status: number; json: T }> {
  await waitForClerk(page)
  return page.evaluate(
    async ({ method, path, body, orgId, asOldBuild }) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
      const res = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(asOldBuild ? {} : { "x-client-capabilities": "multi-currency" }),
          ...(orgId ? { "x-org-id": orgId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let json: unknown = null
      try { json = text ? JSON.parse(text) : null } catch { json = text }
      return { status: res.status, json: json as never }
    },
    { method, path, body, orgId: activeOrgId, asOldBuild },
  )
}

const accounts = async (page: Page) => (await api<Account[]>(page, "GET", "/api/wealth/accounts")).json
const summary = async (page: Page) => (await api<Summary>(page, "GET", "/api/wealth/summary")).json
const balanceOf = async (page: Page, id: string) => Number((await accounts(page)).find((a) => a.id === id)!.current_balance)

/**
 * CI only — `E2E_FX_SEED=1`, set by e2e.yml next to `FX_DISABLED=1` against
 * the DEDICATED e2e database: fixed EUR→INR rates for the last few days, so no
 * conversion here depends on a live provider (MC-128). Rates are GLOBAL, so it
 * must never run against a shared database; locally the spec uses whatever
 * the providers gave and asserts against the rate the server reports.
 */
const SEEDED_EUR_INR = "100"
const seeded = process.env.E2E_FX_SEED === "1"
async function seedFxRates() {
  if (!seeded) return
  const sql = neon(process.env.DATABASE_URL!)
  for (let d = 0; d < 4; d++) {
    const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
    await sql`insert into fx_rate_snapshots (base_currency, quote_currency, rate, rate_date, provider, source_type, is_fallback, observed_at)
      values ('EUR', 'INR', ${SEEDED_EUR_INR}, ${day}, 'e2e-fixed', 'manual', false, now())
      on conflict (base_currency, quote_currency, rate_date, provider, source_type) do update set rate = excluded.rate, fetched_at = now()`
  }
}

/** Into this run's workspace — the API calls carry its id, the browser mirrors it. */
async function useMcOrg(page: Page, orgId: string) {
  await page.goto("/dashboard")
  await expectAppShell(page)
  activeOrgId = orgId
  await switchWorkspace(page, api, orgId)
}

async function makeWallet(page: Page, name: string, currency: string, opening: string): Promise<string> {
  const made = await api<Account>(page, "POST", "/api/wealth/accounts", {
    type: "cash", bank_name: name, nickname: name, currency_code: currency, opening_balance: opening,
  })
  expect(made.status, JSON.stringify(made.json)).toBe(201)
  return made.json.id
}

test.describe.configure({ mode: "serial" })

test.describe("multi-currency", () => {
  let mcOrgId = ""
  let restoreOrgId = ""
  let eurId = ""
  let inrId = ""

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: "e2e/.auth/user.json" } as never)
    try {
      await page.goto("/dashboard")
      await expectAppShell(page)
      restoreOrgId = await rememberWorkspace(page, api)
      await seedFxRates()
      activeOrgId = ""
      const made = await api<{ id: string }>(page, "POST", "/api/organizations", { name: `${MC_ORG_PREFIX}-${Date.now()}`, currency: "EUR" })
      expect(made.status, JSON.stringify(made.json)).toBe(201)
      mcOrgId = made.json.id
    } finally {
      await page.close()
    }
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: "e2e/.auth/user.json" } as never)
    try {
      await page.goto("/dashboard")
      await restoreWorkspace(page, api, restoreOrgId)
      activeOrgId = ""
      if (mcOrgId) expect((await api(page, "DELETE", `/api/organizations/${mcOrgId}`)).status).toBe(204)
    } finally {
      await page.close()
    }
  })

  test("an account keeps its own currency, and the workspace reports in one", async ({ page }) => {
    await useMcOrg(page, mcOrgId)
    expect((await summary(page)).reporting_currency).toBe("EUR")

    eurId = await makeWallet(page, EUR_BANK, "EUR", "1000.00")
    inrId = await makeWallet(page, INR_BANK, "INR", "75000.00")

    const rows = await accounts(page)
    expect(rows.find((a) => a.id === eurId)!.currency_code).toBe("EUR")
    expect(rows.find((a) => a.id === inrId)!.currency_code).toBe("INR")
    // Each wallet holds its opening amount in ITS OWN currency — nothing was
    // reinterpreted into the workspace's.
    expect(await balanceOf(page, eurId)).toBeCloseTo(1000, 2)
    expect(await balanceOf(page, inrId)).toBeCloseTo(75000, 2)
  })

  test("an old app build cannot create money in another currency", async ({ page }) => {
    await useMcOrg(page, mcOrgId)
    // A store-pinned build adds currencies up unconverted, so it must not be
    // able to create a foreign account (MC-034). Nothing is created here.
    const old = await api<{ code?: string }>(page, "POST", "/api/wealth/accounts", {
      type: "cash", bank_name: `${E2E_PREFIX}-mc-oldbuild`, nickname: `${E2E_PREFIX}-mc-oldbuild`, icon: "wallet", openingBalance: 0, currency_code: "INR",
    }, true)
    expect(old.status).toBe(409)
    expect(old.json.code).toBe("client_update_required")
  })

  test("consolidated wealth converts without touching native balances", async ({ page }) => {
    await useMcOrg(page, mcOrgId)
    const raw = await api<Summary>(page, "GET", "/api/wealth/summary")
    expect(raw.status, JSON.stringify(raw.json).slice(0, 300)).toBe(200)
    const s = raw.json
    expect(s.multi_currency).toBe(true)

    const inrRow = s.accounts.find((a) => a.id === inrId)!
    const eurRow = s.accounts.find((a) => a.id === eurId)!
    expect(inrRow, "the INR wallet is in the summary").toBeTruthy()
    expect(eurRow, "the EUR wallet is in the summary").toBeTruthy()
    expect(inrRow.currency).toBe("INR")
    expect(eurRow.currency).toBe("EUR")
    expect(inrRow.native_balance).toBeCloseTo(await balanceOf(page, inrId), 2)

    // A rate exists for both (the service fetches and stores what it needs; CI
    // seeds a fixed one), and the converted value is the native one at THAT rate.
    expect(s.complete, `excluded: ${s.excluded_currencies.join(",")}`).toBe(true)
    expect(inrRow.rate).not.toBeNull()
    if (seeded) expect(Number(inrRow.rate)).toBeCloseTo(1 / Number(SEEDED_EUR_INR), 10)
    expect(inrRow.converted_balance!).toBeCloseTo(inrRow.native_balance * Number(inrRow.rate), 1)
    expect(eurRow.converted_balance!).toBeCloseTo(eurRow.native_balance, 2)

    // Net worth is the sum of the CONVERTED balances, never of raw numbers:
    // 75000 + 1000 = 76000 would be the wrong answer.
    const everyConverted = s.accounts.reduce((t, a) => t + (a.converted_balance ?? 0), 0)
    expect(s.net_worth).toBeCloseTo(everyConverted, 1)
    // The raw sum of native numbers would be a much larger, meaningless figure.
    const rawSum = s.accounts.reduce((t, a) => t + a.native_balance, 0)
    expect(Math.abs(s.net_worth - rawSum), "net worth is not a raw cross-currency sum").toBeGreaterThan(1000)

    // Every currency held is reported natively AND as a share of the total.
    const codes = s.by_currency.map((c) => c.currency)
    expect(codes).toContain("EUR")
    expect(codes).toContain("INR")
    // A fresh workspace: its INR is exactly this wallet.
    expect(s.by_currency.find((c) => c.currency === "INR")!.assets).toBeCloseTo(inrRow.native_balance, 2)
  })

  test("a cross-currency transfer keeps both amounts, its own rate, and charges only the fee", async ({ page }) => {
    await useMcOrg(page, mcOrgId)

    // The paged list carries the workspace's income/expense summary, already in
    // the reporting currency with every row converted at its own date.
    const before = await api<TxSummary>(page, "GET", "/api/transactions?page=1")
    const eurBefore = await balanceOf(page, eurId)
    const inrBefore = await balanceOf(page, inrId)

    // €500 leaves, ₹51,350 arrives, €5 bank fee. The effective rate is 102.70,
    // whatever the market says today — the transfer remembers what it GOT.
    const res = await api<{ transfer_id: string; from_leg: Tx; to_leg: Tx; fee_leg: Tx | null }>(page, "POST", "/api/wealth/transfer", {
      from_account_id: eurId,
      to_account_id: inrId,
      source_amount: "500.00",
      destination_amount: "51350.00",
      source_fee_amount: "5.00",
      source_currency: "EUR",
      destination_currency: "INR",
      note: `${E2E_PREFIX} mc transfer`,
    })
    expect(res.status, JSON.stringify(res.json)).toBe(201)
    expect(res.json.from_leg.amount).toBe("500.00")
    expect(res.json.from_leg.currency_code).toBe("EUR")
    expect(res.json.to_leg.amount).toBe("51350.00")
    expect(res.json.to_leg.currency_code).toBe("INR")
    expect(res.json.fee_leg, "the fee is its own row").toBeTruthy()
    expect(res.json.fee_leg!.amount).toBe("5.00")

    // Source pays principal + fee; destination receives its own native amount.
    expect(await balanceOf(page, eurId)).toBeCloseTo(eurBefore - 505, 2)
    expect(await balanceOf(page, inrId)).toBeCloseTo(inrBefore + 51350, 2)

    // The stored transfer remembers the rate it actually got.
    const list = await api<{ transfers: Transfer[] }>(page, "GET", "/api/wealth/transfers?status=completed&limit=5")
    const tr = list.json.transfers.find((t) => t.id === res.json.transfer_id)!
    expect(tr.source_amount).toBe("500.0000")
    expect(tr.destination_amount).toBe("51350.0000")
    expect(Number(tr.effective_rate)).toBeCloseTo(102.7, 4)
    expect(Number(tr.source_fee_amount)).toBeCloseTo(5, 2)

    // P&L: the transfer is not income and not expense; the FEE is the expense.
    const after = await api<TxSummary>(page, "GET", "/api/transactions?page=1")
    expect(after.json.summary.incoming).toBeCloseTo(before.json.summary.incoming, 2)
    // The workspace reports in EUR and the fee is in EUR: exactly €5.00, not
    // the €500 principal and not a converted approximation.
    expect(after.json.summary.outgoing - before.json.summary.outgoing, "only the fee became an expense").toBeCloseTo(5, 2)
    // And the summary says what unit it is in, rather than leaving it implied.
    expect(after.json.summary.currency).toBe("EUR")
  })

  test("reversing a transfer puts both native amounts back", async ({ page }) => {
    await useMcOrg(page, mcOrgId)
    const eurBefore = await balanceOf(page, eurId)
    const inrBefore = await balanceOf(page, inrId)

    // A fresh workspace holds exactly one completed transfer: the one above.
    const list = await api<{ transfers: Transfer[] }>(page, "GET", "/api/wealth/transfers?status=completed&limit=20")
    expect(list.json.transfers).toHaveLength(1)
    const original = list.json.transfers[0]
    const rev = await api<{ transfer_id: string }>(page, "POST", `/api/wealth/transfers/${original.id}/reverse`, {})
    expect(rev.status, JSON.stringify(rev.json)).toBe(201)

    // The original native amounts come back, and the fee is refunded.
    expect(await balanceOf(page, eurId)).toBeCloseTo(eurBefore + 500 + 5, 2)
    expect(await balanceOf(page, inrId)).toBeCloseTo(inrBefore - 51350, 2)

    // It can only happen once.
    const again = await api<{ code?: string }>(page, "POST", `/api/wealth/transfers/${original.id}/reverse`, {})
    expect(again.status).toBe(409)
    expect(again.json.code).toBe("transfer_already_reversed")
  })

  test("a scheduled transfer moves no money until it is marked done", async ({ page }) => {
    await useMcOrg(page, mcOrgId)
    const eurBefore = await balanceOf(page, eurId)
    const inrBefore = await balanceOf(page, inrId)

    const planned = await api<{ id: string; status: string }>(page, "POST", "/api/wealth/transfer", {
      from_account_id: eurId, to_account_id: inrId,
      source_amount: "100.00", destination_amount: "10000.00",
      source_currency: "EUR", destination_currency: "INR",
      status: "planned", note: `${E2E_PREFIX} planned`,
    })
    expect(planned.status, JSON.stringify(planned.json)).toBe(201)
    expect(planned.json.status).toBe("planned")

    // Nothing moved.
    expect(await balanceOf(page, eurId)).toBeCloseTo(eurBefore, 2)
    expect(await balanceOf(page, inrId)).toBeCloseTo(inrBefore, 2)

    // It is listed as unsettled, then completing it moves the money exactly once.
    const listed = await api<{ transfers: Transfer[] }>(page, "GET", "/api/wealth/transfers")
    expect(listed.json.transfers.some((t) => t.id === planned.json.id)).toBe(true)

    const done = await api(page, "PATCH", `/api/wealth/transfers/${planned.json.id}`, { status: "completed" })
    expect(done.status).toBe(200)
    expect(await balanceOf(page, eurId)).toBeCloseTo(eurBefore - 100, 2)
    expect(await balanceOf(page, inrId)).toBeCloseTo(inrBefore + 10000, 2)

    // A cancelled plan never touches money either.
    const cancelled = await api<{ id: string }>(page, "POST", "/api/wealth/transfer", {
      from_account_id: eurId, to_account_id: inrId,
      source_amount: "7.00", destination_amount: "700.00",
      source_currency: "EUR", destination_currency: "INR",
      status: "planned", note: `${E2E_PREFIX} cancel me`,
    })
    const eurNow = await balanceOf(page, eurId)
    expect((await api(page, "PATCH", `/api/wealth/transfers/${cancelled.json.id}`, { status: "cancelled" })).status).toBe(200)
    expect(await balanceOf(page, eurId)).toBeCloseTo(eurNow, 2)
  })

  test("the wealth screen shows native balances, an approximate value and the currency split", async ({ page }) => {
    await useMcOrg(page, mcOrgId)
    await page.goto("/wealth")
    await expectAppShell(page)

    // Native figures, each in its own currency — ₹ for the INR account.
    const inrTile = page.locator("[data-account-card]").filter({ hasText: INR_BANK }).first()
    await expect(inrTile).toBeVisible({ timeout: 20_000 })
    await expect(inrTile).toContainText("₹")
    // And its approximate value in the reporting currency, never instead of it.
    await expect(inrTile).toContainText("≈")

    const eurTile = page.locator("[data-account-card]").filter({ hasText: EUR_BANK }).first()
    await expect(eurTile).toContainText("€")

    // The by-currency breakdown appears only because this workspace is mixed.
    await expect(page.getByText(/by currency/i).first()).toBeVisible()
    await page.screenshot({ path: "e2e/.artifacts/multi-currency-wealth.png", fullPage: true })
  })
})
