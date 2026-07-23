import { describe, expect, it } from "vitest"

import { applicationsByAccount, balanceDelta, reversalsByAccount, reverseDelta, reversesOnTrash } from "./wealth-ledger"

describe("wealth-ledger", () => {
  it("incoming adds, outgoing subtracts on create", () => {
    expect(balanceDelta("incoming", 100)).toBe(100)
    expect(balanceDelta("outgoing", 100)).toBe(-100)
  })

  it("accepts string amounts (DB numeric columns serialize as strings)", () => {
    expect(balanceDelta("incoming", "42.50")).toBe(42.5)
    expect(balanceDelta("outgoing", "42.50")).toBe(-42.5)
  })

  it("reverseDelta exactly undoes balanceDelta for both directions", () => {
    // Regression guard: deleting an outgoing tx must ADD the money back, and
    // deleting an incoming tx must REMOVE it. (A research pass once claimed the
    // outgoing reversal was inverted — it is not; this locks the sign.)
    for (const type of ["incoming", "outgoing"]) {
      for (const amount of [0, 1, 99.99, 1000]) {
        expect(balanceDelta(type, amount) + reverseDelta(type, amount)).toBe(0)
      }
    }
    expect(reverseDelta("outgoing", 100)).toBe(100)
    expect(reverseDelta("incoming", 100)).toBe(-100)
  })

  describe("reversalsByAccount (bulk/split delete)", () => {
    it("aggregates multiple legs on one account into a single reversal", () => {
      // A split: +200 incoming on acct A, −50 outgoing on acct A. Deleting both
      // must reverse to net −200 (+50) = −150 on A (i.e. undo +200 and undo −50).
      const shifts = reversalsByAccount([
        { wealthAccountId: "A", type: "incoming", amount: "200" },
        { wealthAccountId: "A", type: "outgoing", amount: "50" },
      ])
      expect(shifts.get("A")).toBe(-150)
      expect(shifts.size).toBe(1)
    })

    it("splits legs across their own accounts and ignores account-less legs", () => {
      const shifts = reversalsByAccount([
        { wealthAccountId: "A", type: "incoming", amount: 100 },
        { wealthAccountId: "B", type: "outgoing", amount: 30 },
        { wealthAccountId: null, type: "incoming", amount: 999 },
      ])
      expect(shifts.get("A")).toBe(-100) // undo the +100
      expect(shifts.get("B")).toBe(30) // undo the −30
      expect(shifts.has("null")).toBe(false)
      expect(shifts.size).toBe(2)
    })

    it("returns an empty map for no legs", () => {
      expect(reversalsByAccount([]).size).toBe(0)
    })
  })

  describe("applicationsByAccount (restore from trash)", () => {
    it("is the exact inverse of reversalsByAccount", () => {
      const legs = [
        { wealthAccountId: "A", type: "incoming", amount: "200" },
        { wealthAccountId: "A", type: "outgoing", amount: "50" },
        { wealthAccountId: "B", type: "incoming", amount: 10 },
      ]
      const applied = applicationsByAccount(legs)
      const reversed = reversalsByAccount(legs)
      for (const acct of ["A", "B"]) {
        expect((applied.get(acct) ?? 0) + (reversed.get(acct) ?? 0)).toBe(0)
      }
      expect(applied.get("A")).toBe(150) // re-apply +200 then −50
      expect(applied.get("B")).toBe(10)
    })
  })

  describe("reversesOnTrash (system balance-defining entries)", () => {
    it("standard entries reverse on trash; system entries do not", () => {
      expect(reversesOnTrash({})).toBe(true)
      expect(reversesOnTrash({ isSystem: false })).toBe(true)
      expect(reversesOnTrash({ isSystem: null })).toBe(true)
      // Opening Balance / Balance Adjustment (azzeramento/reset) — must NOT move money.
      expect(reversesOnTrash({ isSystem: true })).toBe(false)
    })

    it("deleting a reset ('Balance Adjustment') never re-credits the account", () => {
      // The azzeramento bug: user zeroes a €300 wallet — the reset posts an
      // outgoing €300 system tx and current_balance becomes 0. Deleting that
      // reset must leave the balance at 0, NOT re-deposit the €300.
      const resetLeg = { wealthAccountId: "A", type: "outgoing", amount: "300", isSystem: true }
      expect(reversalsByAccount([resetLeg]).size).toBe(0) // no balance shift at all
      expect(applicationsByAccount([resetLeg]).size).toBe(0) // and none on restore either
    })

    it("system legs are skipped even when mixed with standard legs on one account", () => {
      const shifts = reversalsByAccount([
        { wealthAccountId: "A", type: "incoming", amount: "100" }, // normal income
        { wealthAccountId: "A", type: "outgoing", amount: "300", isSystem: true }, // reset — ignored
      ])
      expect(shifts.get("A")).toBe(-100) // only the normal income is undone
      expect(shifts.size).toBe(1)
    })

    it("system legs are excluded from restore re-application too", () => {
      const applied = applicationsByAccount([
        { wealthAccountId: "A", type: "incoming", amount: "40" },
        { wealthAccountId: "A", type: "outgoing", amount: "300", isSystem: true },
      ])
      expect(applied.get("A")).toBe(40) // only the normal income is re-applied
    })
  })
})
