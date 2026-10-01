// What `npm run audit:balances -- --apply` may write (MC-061): one exact row per
// drifting account it can explain, never one over a finding that may BE the drift.
// Plain JS syntax on purpose: eslint parses scripts/ without the TS parser.
import { describe, expect, it } from "vitest"
// @ts-expect-error — plain .mjs module (the CLI's repair half); vitest resolves it fine.
import { applyStatements, GUARD_SQL, LEDGER, MARK_TRASHED_SQL, POST_SQL, repairPlan } from "./audit-balances-repair.mjs"

const A = "aaaaaaaa-0000-0000-0000-000000000001"
const B = "bbbbbbbb-0000-0000-0000-000000000002"
const account = (over = {}) => ({
  id: A, currency_code: "USD", drift_exact: "-662.15", drifted: true, own_client: "c1", has_opening: true, opening_balance: "500.0000", ...over,
})
const empty = { broken: [], trashMismatch: [], headerless: [], mismatched: [] }
const plan = (over) => repairPlan({ accounts: [account()], ...empty, ...over })

describe("balance repair rows", () => {
  it("posts exactly the drift, signed from the exact text (no float)", () => {
    expect(plan({}).posts.map((p) => [p.type, p.amount])).toEqual([["outgoing", "662.15"]])
    const up = repairPlan({ accounts: [account({ drift_exact: "0.1000" })], ...empty })
    expect(up.posts[0]).toMatchObject({ type: "incoming", amount: "0.1000" })
  })

  it("never touches an account without drift", () => {
    expect(repairPlan({ accounts: [account({ drifted: false })], ...empty })).toEqual({ posts: [], refused: [], markTrashed: [], deleteHeaders: [] })
  })

  it("refuses a NULL currency or a workspace with no own client", () => {
    expect(repairPlan({ accounts: [account({ currency_code: null })], ...empty }).refused[0].reasons).toEqual(["the account has no currency"])
    expect(repairPlan({ accounts: [account({ own_client: null })], ...empty }).refused[0].reasons).toEqual(["the workspace has no own client to post on"])
  })

  it("refuses an account whose ledger ASSUMES its opening_balance column (no opening row found)", () => {
    // e.g. the opening row's category AND description were relabelled: the
    // formula would count it twice and the row would bake that in.
    const guessed = repairPlan({ accounts: [account({ has_opening: false })], ...empty })
    expect(guessed.posts).toEqual([])
    expect(guessed.refused[0].reasons[0]).toMatch(/opening_balance column \(500\.0000\)/)
    // A zero column adds nothing: no guess, the row is posted.
    expect(repairPlan({ accounts: [account({ has_opening: false, opening_balance: "0.0000" })], ...empty }).posts).toHaveLength(1)
    // The opening row is found by category OR description.
    expect(LEDGER).toContain("'Opening Balance' in (t.category, t.description)")
  })

  it("refuses an account a finding it cannot explain touches — and only that account", () => {
    const cases = [
      { broken: [{ id: "t1", rows: 2, legs: 2, fee: "5.00", fee_rows: "0.00", accounts: [A, B] }] },
      { trashMismatch: [{ id: "t2", all_trashed: false, accounts: [B, A] }] },
      { headerless: [{ id: "g1", accounts: [A] }] },
      { mismatched: [{ id: "r1", account: A, row_ccy: "EUR" }] },
    ]
    for (const c of cases) {
      const p = plan(c)
      expect(p.posts).toEqual([])
      expect(p.refused).toHaveLength(1)
    }
    const elsewhere = plan({ headerless: [{ id: "g1", accounts: [B] }] })
    expect(elsewhere.posts).toHaveLength(1)
  })
})

describe("transfer header repairs", () => {
  it("MC-116: a live header over all-trashed rows is moved to Trash and blocks nothing", () => {
    const p = plan({ trashMismatch: [{ id: "t2", all_trashed: true, accounts: [A, B] }] })
    expect(p.markTrashed).toEqual(["t2"])
    expect(p.posts).toHaveLength(1)
  })

  it("never moves a header that is not whole to Trash, even when every row it has left is trashed", () => {
    // One leg left (or only its fee row): restoring it would re-apply one side.
    const p = plan({
      broken: [{ id: "t4", rows: 1, legs: 1, fee: "0.00", fee_rows: "0.00", legacy: true, linked: false, accounts: [A, B] }],
      trashMismatch: [{ id: "t4", all_trashed: true, accounts: [A, B] }],
    })
    expect(p).toMatchObject({ markTrashed: [], deleteHeaders: [], posts: [] })
    expect(p.refused[0].reasons).toEqual([expect.stringContaining("is not whole")])
    // …and the statement re-checks wholeness at write time.
    expect(MARK_TRASHED_SQL).toContain("count(*) filter (where kind = 'transfer') = 2")
    expect(MARK_TRASHED_SQL).toContain("r.fee_rows = h.source_fee_amount")
  })

  it("deletes only a row-less, pre-0080, unlinked header; anything else is reported", () => {
    const h = { id: "t3", rows: 0, legs: 0, fee: "0.00", fee_rows: "0.00", accounts: [A, B] }
    expect(plan({ broken: [{ ...h, legacy: true, linked: false }] })).toMatchObject({ deleteHeaders: ["t3"], refused: [] })
    expect(plan({ broken: [{ ...h, legacy: false, linked: false }] })).toMatchObject({ deleteHeaders: [], refused: [{}] })
    expect(plan({ broken: [{ ...h, legacy: true, linked: true }] })).toMatchObject({ deleteHeaders: [], refused: [{}] })
  })

  it("--apply <account> keeps only that account's row and the headers it is a side of", () => {
    const p = repairPlan({
      accounts: [account(), account({ id: B })],
      ...empty,
      trashMismatch: [{ id: "mine", all_trashed: true, accounts: [A, "x"] }, { id: "other", all_trashed: true, accounts: [B, "x"] }],
      only: A,
    })
    expect(p.posts.map((x) => x.account.id)).toEqual([A])
    expect(p.markTrashed).toEqual(["mine"])
  })
})

describe("apply statements", () => {
  it("guard first (aborts on any change since the plan), then the rows; nothing for an empty plan", () => {
    const stmts = applyStatements(plan({}), 1)
    expect(stmts.map(([text]) => text)).toEqual([GUARD_SQL, POST_SQL])
    expect(stmts[0][1]).toEqual([[A], ["-662.15"], ["USD"]])
    expect(applyStatements({ posts: [], refused: [], markTrashed: [], deleteHeaders: [] }, 1)).toEqual([])
  })

  it("posts a system row and never rewrites the stored balance", () => {
    expect(POST_SQL).toContain("is_system")
    expect(POST_SQL).not.toMatch(/update\s+wealth_accounts/i)
    expect(GUARD_SQL).toContain("1 / (case when count(*) = 0 then 1 else 0 end)")
  })
})
