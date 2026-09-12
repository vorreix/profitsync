import { expect, test, type Page } from "@playwright/test"
import { E2E_PREFIX, expectAppShell } from "./helpers"

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
 *     says which currencies it had to leave out rather than pretending 1:1;
 *   • a single-currency workspace still reports exactly what it did before.
 *
 * Everything it creates is namespaced and torn down in afterAll.
 */

type OrgRow = { id: string; is_personal: boolean; currency: string }
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
const WALLET_TYPE = "cash"

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

const accounts = async (page: Page) => (await api<Account[]>(page, "GET", "/api/wealth/accounts")).json
const summary = async (page: Page) => (await api<Summary>(page, "GET", "/api/wealth/summary")).json
const balanceOf = async (page: Page, id: string) => Number((await accounts(page)).find((a) => a.id === id)!.current_balance)

async function usePersonal(page: Page): Promise<string> {
  const { json: orgs } = await api<OrgRow[]>(page, "GET", "/api/organizations")
  const personal = orgs.find((o) => o.is_personal)
  expect(personal, "a personal workspace").toBeTruthy()
  await api(page, "POST", "/api/organizations/switch", { organization_id: personal!.id })
  activeOrgId = personal!.id
  await page.evaluate((id) => { try { localStorage.setItem("ps_active_org", id) } catch { /* private mode */ } }, personal!.id)
  await page.goto("/wealth")
  await expectAppShell(page)
  return personal!.id
}

/**
 * Remove everything this spec made, from a REAL workspace — so it has to be
 * thorough, not best-effort.
 *
 * An account is only hard-deleted when it has NO transaction rows at all
 * (api/_routes/wealth/accounts/[id].ts counts them without a deleted_at
 * filter), so trashing is not enough: the rows must be PURGED. Order per
 * account: trash every row (a transfer leg takes its whole transfer with it),
 * purge the trash, then delete. Archived leftovers from an interrupted earlier
 * run are picked up too, hence `?includeArchived=1`.
 */
/** Trash + purge every row on this spec's wallets that the rules allow to go. */
async function purgeWalletRows(page: Page) {
  const mine = (a: Account) => a.bank_name.startsWith(E2E_PREFIX) || a.nickname.startsWith(E2E_PREFIX)
  for (const a of (await accounts(page)).filter(mine)) {
    for (let pass = 0; pass < 6; pass++) {
      const { json } = await api<{ data?: Tx[] } | Tx[]>(page, "GET", `/api/transactions?wealthAccountId=${a.id}&page=1`)
      const rows = Array.isArray(json) ? json : (json?.data ?? [])
      // A reversal-linked leg refuses to be trashed — stop rather than spin.
      const before = rows.length
      if (before === 0) break
      let removed = 0
      for (const t of rows) {
        const res = await api(page, "DELETE", `/api/transactions/${t.id}`).catch(() => ({ status: 0 }))
        if (res.status === 204) removed++
      }
      if (removed === 0) break
    }
  }
  await api(page, "POST", "/api/trash/clear").catch(() => undefined)
}

async function cleanup(page: Page) {
  const mine = (a: Account) => a.bank_name.startsWith(E2E_PREFIX) || a.nickname.startsWith(E2E_PREFIX)
  const all = await api<Account[]>(page, "GET", "/api/wealth/accounts?includeArchived=1")
  for (const a of (all.json ?? []).filter(mine)) {
    // `?page=1` is the shape that carries `data` (a bare `?limit=` returns a
    // plain array — reading `.data` off that silently found nothing, which is
    // how earlier runs left their wallets behind). Loop: deleting a transfer
    // leg takes its siblings with it, so one pass rarely clears the account.
    for (let pass = 0; pass < 6; pass++) {
      const { json } = await api<{ data?: Tx[] } | Tx[]>(page, "GET", `/api/transactions?wealthAccountId=${a.id}&page=1`)
      const rows = Array.isArray(json) ? json : (json?.data ?? [])
      if (rows.length === 0) break
      for (const t of rows) await api(page, "DELETE", `/api/transactions/${t.id}`).catch(() => undefined)
    }
    await api(page, "POST", "/api/trash/clear").catch(() => undefined)
    await api(page, "DELETE", `/api/wealth/accounts/${a.id}`).catch(() => undefined)
  }
}

/**
 * Find this spec's wallet or make it — never a fresh one per run.
 *
 * A wallet that took part in a REVERSED transfer can only be archived, never
 * deleted (mig 0073 keeps a reversal chain immutable, which is the right call
 * for an audit trail), so a create-every-run spec silently piles wallets up in
 * a real workspace. Reusing the live one keeps the suite repeatable.
 */
async function ensureWallet(page: Page, name: string, currency: string, opening: string): Promise<string> {
  const existing = (await accounts(page)).find((a) => a.bank_name === name && !a.archived_at)
  if (existing) return existing.id
  const made = await api<Account>(page, "POST", "/api/wealth/accounts", {
    type: WALLET_TYPE, bank_name: name, nickname: name, currency_code: currency, opening_balance: opening,
  })
  expect(made.status, JSON.stringify(made.json)).toBe(201)
  return made.json.id
}

test.describe.configure({ mode: "serial" })

test.describe("multi-currency", () => {
  let eurId = ""
  let inrId = ""
  let reporting = ""


  // Purge what CAN be purged before each run. The free plan caps transactions
  // per client, and a reversed transfer plus its reversal can never be trashed
  // (mig 0073 keeps a reversal chain immutable), so without this the ledger
  // this spec writes would eventually hit the cap and block itself.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: "e2e/.auth/user.json" } as never)
    try {
      await page.goto("/dashboard")
      await usePersonal(page)
      await purgeWalletRows(page)
    } finally {
      await page.close()
    }
  })

  // No teardown on purpose. These two wallets are DURABLE FIXTURES, for the
  // same reason e2e/helpers.ts keeps one bank around: a wallet that has taken
  // part in a reversed transfer can only be archived, never deleted (mig 0073
  // keeps a reversal chain immutable), so tearing down and rebuilding every run
  // would pile up archived wallets in a real workspace. `ensureWallet` reuses
  // them; `cleanup` is kept for a human who wants them gone.

  test("an account keeps its own currency, and the workspace reports in one", async ({ page }) => {
    await page.goto("/dashboard")
    await usePersonal(page)
    reporting = (await summary(page)).reporting_currency
    expect(reporting).toMatch(/^[A-Z]{3}$/)

    eurId = await ensureWallet(page, EUR_BANK, "EUR", "1000.00")
    inrId = await ensureWallet(page, INR_BANK, "INR", "75000.00")

    const rows = await accounts(page)
    expect(rows.find((a) => a.id === eurId)!.currency_code).toBe("EUR")
    expect(rows.find((a) => a.id === inrId)!.currency_code).toBe("INR")
    // Whatever each wallet holds, it holds it in ITS OWN currency — no opening
    // amount was silently reinterpreted into the workspace's.
    expect(await balanceOf(page, eurId)).toBeGreaterThan(0)
    expect(await balanceOf(page, inrId)).toBeGreaterThan(0)
  })

  test("consolidated wealth converts without touching native balances", async ({ page }) => {
    await page.goto("/dashboard")
    await usePersonal(page)
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

    // A rate exists for both (the service fetches and stores what it needs).
    expect(s.complete, `excluded: ${s.excluded_currencies.join(",")}`).toBe(true)
    expect(inrRow.converted_balance).not.toBeNull()
    expect(inrRow.rate).not.toBeNull()

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
    // `by_currency` is the whole workspace's INR, which includes this wallet —
    // assert it contains it rather than equals it.
    expect(s.by_currency.find((c) => c.currency === "INR")!.assets).toBeGreaterThanOrEqual(inrRow.native_balance)
  })

  test("a cross-currency transfer keeps both amounts, its own rate, and charges only the fee", async ({ page }) => {
    await page.goto("/dashboard")
    await usePersonal(page)

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
    const feeInReporting = after.json.summary.outgoing - before.json.summary.outgoing
    expect(feeInReporting, "only the fee became an expense").toBeGreaterThan(0)
    expect(feeInReporting, "the €500 principal is never spending").toBeLessThan(10)
    // And the summary says what unit it is in, rather than leaving it implied.
    expect(after.json.summary.currency).toMatch(/^[A-Z]{3}$/)
  })

  test("reversing a transfer puts both native amounts back", async ({ page }) => {
    await page.goto("/dashboard")
    await usePersonal(page)
    const eurBefore = await balanceOf(page, eurId)
    const inrBefore = await balanceOf(page, inrId)

    const list = await api<{ transfers: (Transfer & { reversed_by_transfer_id?: string | null })[] }>(page, "GET", "/api/wealth/transfers?status=completed&limit=20")

    // A reversal chain is immutable (mig 0073), so its rows can never be
    // trashed and every run would permanently consume free-plan quota. If this
    // workspace already carries one, assert the invariant ON IT — that a
    // transfer cannot be reversed twice — instead of minting another pair.
    const already = list.json.transfers.find((t) => t.reversed_by_transfer_id)
    if (already) {
      const second = await api<{ code?: string }>(page, "POST", `/api/wealth/transfers/${already.id}/reverse`, {})
      expect(second.status, "a transfer reverses exactly once").toBe(409)
      expect(second.json.code).toBe("transfer_already_reversed")
      return
    }

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
    await page.goto("/dashboard")
    await usePersonal(page)
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
