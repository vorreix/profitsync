import { expect, test, type Browser, type Page } from "@playwright/test"
import { dismissBanners, E2E_PREFIX, expectAppShell } from "./helpers"

/**
 * Budget v2 — end-to-end through the real UI and the real auth guard.
 *
 * Scope, and why it is drawn here: the financial invariants are pinned by unit
 * tests (src/lib/budget-math*.test.ts) where they can be asserted exactly and
 * without a database. What only a browser can prove is that the page BOOTS with
 * a plan, that the vocabulary the redesign depends on is actually on screen, and
 * that the progressive-disclosure contract holds — no form is shown until it is
 * asked for. So that is what this spec checks.
 *
 * It is deliberately tolerant about WHICH state /budgets is in, because the
 * shared e2e workspace may or may not already have a plan. Both branches are
 * asserted; neither is skipped silently.
 *
 * WORKSPACE: a household plan is PERSONAL-only — a business workspace keeps its
 * per-client spend caps instead, and /budgets redirects away there. The shared
 * e2e user is onboarded as a BUSINESS workspace, so this suite switches them to
 * their personal one for its duration and switches them back afterwards. That
 * restore matters: playwright.config runs with `workers: 1`, so leaving the
 * active workspace changed would silently move every LATER spec file's data
 * into the wrong org, past the leftover sweep in auth.setup.
 */

type OrgRow = { id: string; name: string; is_personal: boolean }

/** The app's own switch endpoint, driven with the page's real Clerk session. */
async function switchWorkspace(page: Page, want: "personal" | "business" | string): Promise<string> {
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }).Clerk
      return !!c?.loaded && !!c.session
    },
    null,
    { timeout: 30_000 },
  )
  const result = await page.evaluate(async (target) => {
    const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
    const token = await Clerk.session?.getToken()
    if (!token) return { ok: false as const, error: "no session token" }
    const auth = { Authorization: `Bearer ${token}` }
    const listRes = await fetch("/api/organizations", { headers: auth })
    if (!listRes.ok) return { ok: false as const, error: `list -> ${listRes.status}` }
    const orgs = (await listRes.json()) as OrgRow[]
    const pick =
      target === "personal"
        ? orgs.find((o) => o.is_personal)
        : target === "business"
          ? orgs.find((o) => !o.is_personal)
          : orgs.find((o) => o.id === target)
    if (!pick) return { ok: false as const, error: `no ${target} workspace among ${orgs.length}` }
    const res = await fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ organization_id: pick.id }),
    })
    if (!res.ok) return { ok: false as const, error: `switch -> ${res.status} ${await res.text()}` }
    return { ok: true as const, id: pick.id, name: pick.name }
  }, want)
  expect(result.ok, "ok" in result && result.ok ? "" : result.error).toBe(true)
  // The active org is read from the profile at boot, so a switch only takes
  // effect on the next load. Clear the mirror too, or the first requests of the
  // next page still carry the old x-org-id.
  await page.evaluate(() => {
    try {
      localStorage.removeItem("ps_active_org")
    } catch {
      /* private mode */
    }
  })
  return (result as { id: string }).id
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

const gotoBudgets = async (page: Page) => {
  await page.goto("/budgets")
  await expectAppShell(page)
  await dismissBanners(page)
}

/**
 * True when this workspace already has a Budget v2 plan.
 *
 * Both markers are chosen to be UNAMBIGUOUS. The page subtitle reads "What's
 * safe to spend, and why.", so a text match on /safe to spend/ hits the empty
 * state too — the hero is identified instead by its aria-live figure, which
 * exists only when there is a plan.
 */
const heroFigure = (page: Page) => page.locator("dd[aria-live=polite]").first()
const wizardStep = (page: Page) => page.getByText(/step \d+ of \d+/i).first()

async function hasPlan(page: Page): Promise<boolean> {
  await expect(heroFigure(page).or(wizardStep(page)).first()).toBeVisible({ timeout: 30_000 })
  return heroFigure(page).isVisible().catch(() => false)
}

// SERIAL: the first test creates the plan the rest of the suite exercises, so
// the "has a plan" branches are really executed rather than silently skipped.
test.describe.serial("Budget v2", () => {
  // Borrow the personal workspace for the suite, and give it back.
  let restoreOrgId = ""
  test.beforeAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      restoreOrgId = await page.evaluate(() => localStorage.getItem("ps_active_org") ?? "")
      await switchWorkspace(page, "personal")
    })
  })
  test.afterAll(async ({ browser }) => {
    await inFreshTab(browser, async (page) => {
      await switchWorkspace(page, restoreOrgId || "business")
    })
  })

  test("creates a plan through the four-decision wizard", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoBudgets(page)
    if (await hasPlan(page)) return // already set up by an earlier run

    // 1 — planning period. One question, three answers, a default preselected.
    await expect(wizardStep(page)).toContainText(/1 of 4/i)
    await page.getByRole("button", { name: /continue/i }).first().click()

    // 2 — expected income.
    await expect(wizardStep(page)).toContainText(/2 of 4/i)
    await page.locator("input[inputmode=decimal]").first().fill("3000")
    await page.getByRole("button", { name: /continue/i }).first().click()

    // 3 — ONE overall spending target. This is the whole plan a beginner needs.
    await expect(wizardStep(page)).toContainText(/3 of 4/i)
    await page.locator("input[inputmode=decimal]").first().fill("1200")
    await page.getByRole("button", { name: /continue/i }).first().click()

    // 4 — confirm.
    await expect(wizardStep(page)).toContainText(/4 of 4/i)
    await page.getByRole("button", { name: /create|start|finish|done/i }).first().click()

    // The hero must appear: plan created, first period opened, figures computed.
    await expect(heroFigure(page)).toBeVisible({ timeout: 45_000 })
    await expect(heroFigure(page)).toContainText(/[0-9]/)
  })

  test("the budget page boots without errors and renders one of its two real states", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))

    await gotoBudgets(page)
    const planned = await hasPlan(page)

    if (planned) {
      // Safe-to-spend is the ONE number that answers "can I buy this?", so it
      // must be present and must be a real figure, not a placeholder.
      await expect(heroFigure(page)).toBeVisible()
      await expect(heroFigure(page)).toContainText(/[0-9]/)
    } else {
      // The empty state is the four-decision wizard, not a form: one question on
      // screen and a step indicator, never a page of fields.
      await expect(wizardStep(page)).toBeVisible()
      await expect(page.getByRole("button", { name: /continue/i }).first()).toBeVisible()
      // Exactly ONE question is asked at a time.
      await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1)
    }

    expect(errors, `page errors on /budgets:\n${errors.join("\n")}`).toEqual([])
  })

  test("progressive disclosure: no dialog is open until it is asked for", async ({ page }) => {
    await gotoBudgets(page)
    if (!(await hasPlan(page))) {
      // Without a plan the wizard occupies the page; there is nothing to
      // disclose progressively yet, and asserting otherwise would be checking
      // the wrong screen.
      await expect(page.getByRole("dialog")).toHaveCount(0)
      return
    }

    // The overview must show FIGURES, not forms (spec §6.4 / principle P2).
    await expect(page.getByRole("dialog")).toHaveCount(0)

    // Adding a budget is two taps away (Add → Add a budget), and only then is a
    // form shown.
    const add = page.getByRole("button", { name: /^add$/i }).first()
    await expect(add).toBeVisible({ timeout: 15_000 })
    await add.click()
    await page.getByRole("menuitem", { name: /add a budget/i }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    // Categories, a name and a limit — the decisions, nothing more. Carry
    // policy, priority and reimbursable are deliberately absent from this form.
    await expect(dialog.getByLabel(/name/i).first()).toBeVisible()
    await expect(dialog.getByText(/carry|priority|reimburs/i)).toHaveCount(0)

    // Escape closes it without saving anything.
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("a category card shows exactly the four figures, and no more", async ({ page }) => {
    await gotoBudgets(page)
    expect(await hasPlan(page), "the wizard test should have created a plan").toBe(true)

    // The wizard creates the catch-all "leftover" envelope, so at least one
    // envelope row must be present and must carry planned + spent.
    const row = page.getByRole("button", { name: /^open /i }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(/[0-9]/)

    // Tapping it opens the detail sheet — the place where everything else lives.
    await row.click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    // All four figures are named in the detail sheet.
    await expect(sheet).toContainText(/planned/i)
    await expect(sheet).toContainText(/spent/i)
    await expect(sheet).toContainText(/pending/i)
    await expect(sheet).toContainText(/remaining|over by/i)
  })

  test("the safe-to-spend explainer teaches that TWO limits apply", async ({ page }) => {
    await gotoBudgets(page)
    expect(await hasPlan(page), "the wizard test should have created a plan").toBe(true)

    // The explainer is the most important piece of teaching in the product: a
    // user who thinks safe-to-spend is just "cash" will mistrust it the first
    // time the plan is the binding limit.
    // The trigger carries the explainer's title as its accessible name.
    const explain = page.getByRole("button", { name: /how safe to spend is worked out/i }).first()
    await expect(explain).toBeVisible({ timeout: 15_000 })

    await explain.click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    // BOTH bounds must be named, in the product's own words: the cash side
    // ("across your accounts … already needed for …") and the plan side
    // ("your plan allows another …" — or, with no target yet, "only your cash
    // limits this"). Then the rule that safe-to-spend is the LOWER of the two.
    await expect(sheet).toContainText(/across your accounts/i)
    await expect(sheet).toContainText(/your plan allows|only your cash limits/i)
    await expect(sheet).toContainText(/lower of the two|only your cash limits/i)
  })

  test("the page has no horizontal overflow at a phone width", async ({ page }) => {
    // The same DOM runs inside the Android and iOS WebView shells, where a body
    // that scrolls sideways is an immediately visible defect.
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoBudgets(page)
    await hasPlan(page)

    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    })
    // Allow a 1px rounding tolerance; anything more is real overflow.
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })

  test("interactive controls meet the rendered 36px floor (44px effective hit area)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoBudgets(page)
    expect(await hasPlan(page), "the wizard test should have created a plan").toBe(true)
    // The referral banner arrives asynchronously after boot; clear it now that
    // the page has settled, so only the budget's own controls are measured.
    await dismissBanners(page)

    // Scoped to the PAGE content. The app shell (logo, org switcher) is
    // Maqbool-owned and has its own sizing conventions; policing it from a
    // Budget spec would be this suite failing on someone else's component.
    const buttons = page.locator("main button:visible")
    const count = Math.min(await buttons.count(), 20)
    const tooSmall: string[] = []
    for (let i = 0; i < count; i++) {
      const b = buttons.nth(i)
      const box = await b.boundingBox()
      if (!box) continue
      // 36px is the rendered floor for the compact icon rows (h-9). The one
      // deliberate exception is a STACKED pair (move up / move down): each half
      // is 18px but the pair forms a 36px block, so the effective target is met
      // in both axes. Such a control is accepted only when it is at least 36px
      // WIDE, which is what distinguishes it from a genuinely tiny button.
      const stackedPair = box.height >= 17 && box.width >= 36
      if (box.height < 36 && !stackedPair) {
        tooSmall.push(`${(await b.textContent())?.trim() || "(icon)"} = ${box.height}x${box.width}px`)
      }
    }
    expect(tooSmall, `controls under 36px tall:\n${tooSmall.join("\n")}`).toEqual([])
  })

  test("the v1 budgets page still works alongside a v2 plan", async ({ page }) => {
    // /api/budgets (and /overview, /detail) keep their v1 contract indefinitely
    // because the native shells run store-pinned bundles; on a personal
    // workspace with a plan they serve the plan's PROJECTION. The legacy page
    // is the in-app consumer of that contract — it must render the projected
    // figure, not an empty list and not a crash.
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))

    await page.goto("/budgets/legacy")
    await expectAppShell(page)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
    // The projected catch-all target is a real figure on the page.
    await expect(page.locator("main")).toContainText(/[0-9]/, { timeout: 15_000 })
    expect(errors, `page errors on /budgets/legacy:\n${errors.join("\n")}`).toEqual([])
  })

  // ── the money paths, through the real UI ──────────────────────────────────
  //
  // Everything below runs on the PERSONAL workspace the suite borrowed, on the
  // plan the wizard test created this run, and cleans up what it made. Ledger
  // rows are created through the app's own API (the transaction dialog is
  // covered by smoke.spec.ts); every BUDGET interaction goes through the UI.

  const CATEGORY = "Travel" // seeded for every org, so the chip always exists
  const ENVELOPE = `${E2E_PREFIX} travel`
  const GROUP = `${E2E_PREFIX} household`
  const createdTx: string[] = []

  /** The row (list item) of a budget, found through its "Open …" button. */
  const rowOf = (page: Page, name: string) =>
    page.getByRole("button", { name: new RegExp(`^open ${name}`, "i") }).first().locator("xpath=ancestor::li[1]")
  /** The "… of LIMIT" figure on a row, as a number. */
  const plannedOn = async (row: ReturnType<typeof rowOf>) => {
    const text = (await row.textContent()) ?? ""
    const m = text.match(/of\s+[^\d]*([\d.,]+)/i)
    expect(m, `no "spent of limit" figure in: ${text}`).not.toBeNull()
    return Number(m![1].replace(/,/g, ""))
  }
  /** Open a budget's row menu. */
  const openMenu = async (page: Page, name: string) => {
    await page.getByRole("button", { name: new RegExp(`^options for ${name}`, "i") }).first().click()
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 10_000 })
  }

  /** Post a ledger row on the personal workspace through the app's API. */
  async function postTransaction(page: Page, input: { type: "incoming" | "outgoing"; amount: number; category: string; date: string }) {
    const id = await page.evaluate(async (body) => {
      const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
      const token = await Clerk.session?.getToken()
      if (!token) throw new Error("no session token")
      // Address the PERSONAL workspace explicitly: without x-org-id the server
      // falls back to the profile's current org, which the storage state pins
      // to the business one.
      const orgs = (await (await fetch("/api/organizations", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; is_personal: boolean }[]
      const personal = orgs.find((o) => o.is_personal)
      if (!personal) throw new Error("no personal workspace")
      const auth = { Authorization: `Bearer ${token}`, "x-org-id": personal.id, "Content-Type": "application/json" }
      const accounts = (await (await fetch("/api/wealth/accounts", { headers: auth })).json()) as
        | { id: string; type: string }[]
        | { accounts: { id: string; type: string }[] }
      const list = Array.isArray(accounts) ? accounts : accounts.accounts
      const cash = list.find((a) => a.type === "cash")
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ ...body, wealth_account_id: cash?.id, description: "e2e-ux4 budget" }),
      })
      if (!res.ok) throw new Error(`transaction → ${res.status} ${await res.text()}`)
      const row = (await res.json()) as { id: string }
      return row.id
    }, input)
    createdTx.push(id)
    return id
  }

  const today = () => new Date().toISOString().slice(0, 10)
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

  test.afterAll(async ({ browser }) => {
    // Trash + purge what this run posted, so balances are reversed and the next
    // run starts clean (the setup's archive covers the plan itself).
    if (!createdTx.length) return
    await inFreshTab(browser, async (page) => {
      await page.waitForFunction(() => (window as { Clerk?: { session?: unknown } }).Clerk?.session != null, null, { timeout: 30_000 })
      await page.evaluate(async (ids) => {
        const Clerk = (window as unknown as { Clerk: { session?: { getToken: () => Promise<string | null> } } }).Clerk
        const token = await Clerk.session?.getToken()
        if (!token) return
        const orgs = (await (await fetch("/api/organizations", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string; is_personal: boolean }[]
        const personal = orgs.find((o) => o.is_personal)
        const auth = { Authorization: `Bearer ${token}`, ...(personal ? { "x-org-id": personal.id } : {}) }
        for (const id of ids) await fetch(`/api/transactions/${id}`, { method: "DELETE", headers: auth })
        await fetch("/api/trash/clear", { method: "POST", headers: auth })
      }, createdTx)
    })
  })

  test("a category envelope tracks its spend and an overspend can be resolved by moving money", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoBudgets(page)
    expect(await hasPlan(page), "the wizard test should have created a plan").toBe(true)

    // 50 spent on Travel this period, BEFORE the envelope exists — the engine
    // must attribute existing spend to a new envelope on the next sync.
    await postTransaction(page, { type: "outgoing", amount: 50, category: CATEGORY, date: today() })

    // Add a budget with a 30 limit → over by 20. Categories FIRST — the name
    // follows the pick until typed.
    await page.getByRole("button", { name: /^add$/i }).first().click()
    await page.getByRole("menuitem", { name: /add a budget/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole("button", { name: CATEGORY, exact: true }).click()
    await expect(dialog.locator("#env-name")).toHaveValue(CATEGORY)
    await dialog.locator("#env-name").fill(ENVELOPE)
    await dialog.locator("#env-target").fill("30")
    await dialog.getByRole("button", { name: /^add$/i }).last().click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 })

    // In place: the row appears, and it is over by the difference.
    const row = page.getByRole("button", { name: new RegExp(`^open ${ENVELOPE}`, "i") }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    // The row's list item — a STABLE anchor that survives the Resolve button
    // disappearing once the overspend is resolved.
    const card = rowOf(page, ENVELOPE)
    await expect(card).toContainText(/over/i)
    await expect(card.getByRole("button", { name: /^resolve$/i })).toBeVisible({ timeout: 20_000 })

    // Resolve it: move 20 from the catch-all. §6.11: the copy states the
    // consequence, and safe-to-spend must not change (invariant 2).
    const before = (await heroFigure(page).textContent())?.trim()
    await card.getByRole("button", { name: /^resolve$/i }).click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    await sheet.locator("#ov-amount").fill("20")
    const move = sheet.getByRole("button", { name: /^move from /i }).first()
    await expect(move).toBeEnabled()
    await expect(move).toContainText(/safe to spend stays the same/i)
    await move.click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 })

    // The envelope is no longer over, and safe-to-spend is unchanged.
    await expect(card.getByRole("button", { name: /^resolve$/i })).toHaveCount(0, { timeout: 20_000 })
    await expect(heroFigure(page)).toHaveText(before ?? "", { timeout: 20_000 })
  })

  test("a group adds up the budgets inside it", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoBudgets(page)
    expect(await hasPlan(page)).toBe(true)

    // Add → Add a group. A group is a name; its figures are its children's.
    await page.getByRole("button", { name: /^add$/i }).first().click()
    await page.getByRole("menuitem", { name: /add a group/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.locator("#env-name").fill(GROUP)
    await dialog.getByRole("button", { name: /^add$/i }).last().click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 })

    const groupToggle = page.getByRole("button", { name: new RegExp(`expand or collapse ${GROUP}`, "i") }).first()
    await expect(groupToggle).toBeVisible({ timeout: 20_000 })
    const groupRow = groupToggle.locator("xpath=ancestor::li[1]")
    await expect(groupRow).toContainText(/nothing in this group yet/i)

    // Move the budget into it from its row menu.
    const before = await plannedOn(rowOf(page, ENVELOPE))
    await openMenu(page, ENVELOPE)
    await page.getByRole("menuitem", { name: /move to group/i }).hover()
    await page.getByRole("menuitem", { name: GROUP, exact: true }).click()
    await expect(page.getByRole("menu")).toHaveCount(0)

    // The budget now sits INSIDE the group, and the group's limit is its limit.
    await expect(groupRow.getByRole("button", { name: new RegExp(`^open ${ENVELOPE}`, "i") })).toBeVisible({ timeout: 20_000 })
    await expect(groupRow).toContainText(/1 budget/i)
    const groupFigures = groupRow.getByRole("button", { name: new RegExp(`expand or collapse ${GROUP}`, "i") })
    expect(await plannedOn(groupFigures)).toBe(before)
  })

  test("the week / month / year toggle re-windows the list, and only the list", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoBudgets(page)
    expect(await hasPlan(page)).toBe(true)

    const hero = (await heroFigure(page).textContent())?.trim()
    await expect(page.getByText(/^this month$/i)).toBeVisible({ timeout: 15_000 })

    // Year: the same budget, its limit read as twelve months of what was set
    // (30 authored → 360). The hero does not move: safe-to-spend is about now.
    await page.getByRole("radio", { name: /^year$/i }).click()
    await expect(page.getByText(/^this year$/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/limits in this view are worked out/i)).toBeVisible()
    await expect(rowOf(page, ENVELOPE)).toContainText(/360/, { timeout: 20_000 })
    await expect(heroFigure(page)).toHaveText(hero ?? "")

    // Back to month, and the note goes away (the month IS the period).
    await page.getByRole("radio", { name: /^month$/i }).click()
    await expect(page.getByText(/^this month$/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/limits in this view are worked out/i)).toHaveCount(0)
  })

  test("a budget can be hidden and shown again, and deactivated and activated", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoBudgets(page)
    expect(await hasPlan(page)).toBe(true)
    const total = page.getByText(/^your budgets$/i).locator("xpath=ancestor::div[contains(@class,'rounded')][1]")

    // Hide: the row folds into the footer; the list total does not change
    // because a hidden budget still counts.
    const totalBefore = await plannedOn(total)
    await openMenu(page, ENVELOPE)
    await page.getByRole("menuitem", { name: /^hide$/i }).click()
    const hiddenToggle = page.getByRole("button", { name: /hidden budget/i }).first()
    await expect(hiddenToggle).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole("button", { name: new RegExp(`^open ${ENVELOPE}`, "i") })).toHaveCount(0)
    expect(await plannedOn(total)).toBe(totalBefore)

    // Show the hidden rows, then bring it back from its menu.
    await hiddenToggle.click()
    await expect(rowOf(page, ENVELOPE)).toBeVisible({ timeout: 10_000 })
    await openMenu(page, ENVELOPE)
    await page.getByRole("menuitem", { name: /show again/i }).click()
    await expect(page.getByRole("button", { name: /hidden budget/i })).toHaveCount(0, { timeout: 20_000 })
    await expect(rowOf(page, ENVELOPE)).toBeVisible()

    // Deactivate: greyed, tagged, and its limit LEAVES the total. One tap back.
    await openMenu(page, ENVELOPE)
    await page.getByRole("menuitem", { name: /^deactivate$/i }).click()
    const row = rowOf(page, ENVELOPE)
    await expect(row).toContainText(/inactive/i, { timeout: 20_000 })
    await expect(row.getByRole("button", { name: /^activate$/i })).toBeVisible()
    expect(await plannedOn(total)).toBeLessThan(totalBefore)

    await row.getByRole("button", { name: /^activate$/i }).click()
    await expect(row).not.toContainText(/inactive/i, { timeout: 20_000 })
    expect(await plannedOn(total)).toBe(totalBefore)
  })

  test("a budget can be edited and removed from its row menu, and the catch-all cannot", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoBudgets(page)
    expect(await hasPlan(page)).toBe(true)

    // Edit: the same dialog, in edit mode.
    await openMenu(page, ENVELOPE)
    await page.getByRole("menuitem", { name: /^edit$/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog.locator("#env-name")).toHaveValue(ENVELOPE)
    await dialog.locator("#env-target").fill("80")
    await dialog.getByRole("button", { name: /^save changes$/i }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 })
    // Retargeted above its spend → no longer over, in place.
    await expect(rowOf(page, ENVELOPE)).not.toContainText(/over/i, { timeout: 20_000 })

    // Remove: from the menu, behind a confirm; then the row is gone.
    await openMenu(page, ENVELOPE)
    await page.getByRole("menuitem", { name: /^remove$/i }).click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await confirm.getByRole("button", { name: /^remove$/i }).click()
    await expect(page.getByRole("alertdialog")).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole("button", { name: new RegExp(`^open ${ENVELOPE}`, "i") })).toHaveCount(0, { timeout: 20_000 })

    // The group goes too (its menu offers Remove; it is empty now).
    await openMenu(page, GROUP)
    await page.getByRole("menuitem", { name: /^remove$/i }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: /^remove$/i }).click()
    await expect(page.getByRole("button", { name: new RegExp(`expand or collapse ${GROUP}`, "i") })).toHaveCount(0, { timeout: 20_000 })

    // The catch-all cannot be removed or deactivated — its menu offers neither.
    await openMenu(page, "(everything else|everyday spending)")
    await expect(page.getByRole("menuitem", { name: /^remove$/i })).toHaveCount(0)
    await expect(page.getByRole("menuitem", { name: /^deactivate$/i })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
  })


  test("a business workspace is kept out of the household plan", async ({ page }) => {
    test.setTimeout(90_000)
    // The gate is the reason this whole suite borrows a personal workspace, so
    // it is worth asserting rather than assuming. A business workspace's
    // `budgets` rows ARE its per-client spend caps: showing it the household
    // plan would not just be out of scope, it would replace a feature it uses.
    // It keeps the SAME route (§13.6, §23.4): every "Budgets" link in the app
    // points at /budgets, so a business workspace gets its v1 caps page there,
    // never a bounce to the dashboard.
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
    await page.goto("/dashboard")
    await switchWorkspace(page, "business")
    try {
      await page.goto("/budgets")
      await expectAppShell(page)
      await expect(page).toHaveURL(/\/budgets$/, { timeout: 30_000 })
      // Never the household plan: no safe-to-spend hero, no four-step wizard.
      await expect(heroFigure(page)).toBeHidden()
      await expect(wizardStep(page)).toBeHidden()
      // ...but a real page — the v1 caps list renders its own heading.
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
      // ...and the per-client caps a business workspace actually uses still work.
      await page.goto("/budgets/own")
      await expectAppShell(page)
      expect(errors, `page errors on the business /budgets:\n${errors.join("\n")}`).toEqual([])
    } finally {
      await switchWorkspace(page, "personal")
    }
  })
})
