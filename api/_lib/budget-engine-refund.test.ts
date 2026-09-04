import { describe, expect, it } from "vitest"
import { spendForKeys, type CategorySpendRow } from "./budget-engine.js"

// DB-FREE: spendForKeys is pure JS over rows the SQL already grouped. Pins the
// credit-card refund rule for Budget v2 — an explicit refund row (kind='refund')
// is a CONFIRMED reduction of the envelope's spend (a stated fact, like a
// settlement), never a provisional guess and never income.

const rows: CategorySpendRow[] = [
  // Groceries: €300 spent on the card, €40 refunded (kind='refund'), plus a €20
  // ordinary inflow in the same category that is only a provisional guess.
  { key: "groceries", gross: 300, inflow: 20, unlinkedInflow: 20, refund: 40 },
  // Dining: spend only.
  { key: "dining", gross: 120, inflow: 0, unlinkedInflow: 0, refund: 0 },
  // An unclaimed category with a refund — lands in the catch-all.
  { key: "shoes", gross: 100, inflow: 0, unlinkedInflow: 0, refund: 100 },
]
const claimed = new Set(["groceries", "dining"])

describe("budget v2 — explicit refunds (kind='refund') net against spend", () => {
  it("an explicit envelope counts its refunds as CONFIRMED and keeps ordinary inflows provisional", () => {
    const g = spendForKeys(rows, new Map(), ["groceries"], claimed)
    expect(g.spentGross).toBe(300)
    expect(g.refundsConfirmed).toBe(40)
    expect(g.refundsProvisional).toBe(20)
  })

  it("the catch-all nets explicit refunds too (a stated fact), but never provisional inflows", () => {
    const c = spendForKeys(rows, new Map(), [], claimed)
    expect(c.spentGross).toBe(100)
    expect(c.refundsConfirmed).toBe(100) // shoes returned
    expect(c.refundsProvisional).toBe(0)
  })

  it("a linked settlement and an explicit refund add up (both are confirmed facts)", () => {
    const settled = new Map([["groceries", 25]])
    const g = spendForKeys(rows, settled, ["groceries"], claimed)
    expect(g.refundsConfirmed).toBe(65)
  })

  it("a card PAYMENT never reaches these rows at all (transfers are filtered in SQL), so spend is unchanged", () => {
    // The SQL inclusion predicate is kind in ('standard','refund'); a transfer
    // row therefore has no CategorySpendRow. Nothing to net, nothing to add.
    const d = spendForKeys(rows, new Map(), ["dining"], claimed)
    expect(d).toEqual({ spentGross: 120, refundsProvisional: 0, refundsConfirmed: 0 })
  })
})
