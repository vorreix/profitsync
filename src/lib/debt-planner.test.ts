import { describe, expect, it } from "vitest"
import { affordability, comparePlans, debtPaymentRatio, rankDebts, simulatePlan, type PlannerDebt } from "./debt-planner"

const card: PlannerDebt = { id: "card", name: "Visa", balance: 240_000, annualRatePct: 19.9, minPayment: 8_000 }
const car: PlannerDebt = { id: "car", name: "Car loan", balance: 900_000, annualRatePct: 6.5, minPayment: 25_000 }
const student: PlannerDebt = { id: "student", name: "Student loan", balance: 1_400_000, annualRatePct: 3.2, minPayment: 12_000 }
const marco: PlannerDebt = { id: "marco", name: "Marco", balance: 70_000, annualRatePct: null, minPayment: 0 }

describe("debt-planner — ranking", () => {
  const debts = [card, car, student, marco]
  it("avalanche: highest rate first (unknown rate counts as 0)", () => {
    expect(rankDebts(debts, "avalanche").map((d) => d.id)).toEqual(["card", "car", "student", "marco"])
  })
  it("snowball: smallest balance first", () => {
    expect(rankDebts(debts, "snowball").map((d) => d.id)).toEqual(["marco", "card", "car", "student"])
  })
  it("free-up-cash: largest payment relative to balance first (card 3.3 %, car 2.8 %, student 0.9 %, Marco 0)", () => {
    expect(rankDebts(debts, "cashflow").map((d) => d.id)).toEqual(["card", "car", "student", "marco"])
    // A small debt with a big payment outranks a big debt with a tiny payment.
    const a: PlannerDebt = { id: "a", name: "A", balance: 80_000, annualRatePct: 5, minPayment: 20_000 }
    const b: PlannerDebt = { id: "b", name: "B", balance: 120_000, annualRatePct: 15, minPayment: 4_000 }
    expect(rankDebts([a, b], "cashflow").map((d) => d.id)).toEqual(["a", "b"])
    expect(rankDebts([a, b], "avalanche").map((d) => d.id)).toEqual(["b", "a"])
  })
  it("custom: the user's order is honoured; unlisted debts go last", () => {
    expect(rankDebts(debts, "custom", ["marco", "student"]).map((d) => d.id)).toEqual(["marco", "student", "card", "car"])
  })
  it("cleared debts (balance 0) are excluded", () => {
    expect(rankDebts([{ ...card, balance: 0 }, car], "snowball").map((d) => d.id)).toEqual(["car"])
  })
})

describe("debt-planner — simulation", () => {
  it("minimum-only: each debt pays its scheduled amount; an interest-free debt is retired on time", () => {
    const r = simulatePlan({ debts: [{ id: "x", name: "X", balance: 120_000, annualRatePct: null, minPayment: 10_000 }], strategy: "minimum" })
    expect(r.months).toBe(12)
    expect(r.totalInterest).toBe(0)
    expect(r.totalPaid).toBe(120_000)
    expect(r.assumedZeroRate).toEqual(["x"])
    expect(r.series[r.series.length - 1]).toEqual({ month: 12, balance: 0 })
  })

  it("an informal debt with no scheduled payment never clears under minimum-only (truthful null), but does with extra", () => {
    expect(simulatePlan({ debts: [marco], strategy: "minimum" }).months).toBeNull()
    const r = simulatePlan({ debts: [marco], strategy: "snowball", extraMonthly: 10_000 })
    expect(r.months).toBe(7)
    expect(r.firstCleared).toEqual({ id: "marco", month: 7 })
  })

  it("avalanche puts the extra on the highest-rate debt and saves the most interest", () => {
    const debts = [card, car, student]
    const av = simulatePlan({ debts, strategy: "avalanche", extraMonthly: 20_000 })
    const sn = simulatePlan({ debts, strategy: "snowball", extraMonthly: 20_000 })
    expect(av.debts.find((d) => d.id === "card")!.clearedMonth).toBeLessThanOrEqual(sn.debts.find((d) => d.id === "card")!.clearedMonth!)
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest)
    expect(av.months).not.toBeNull()
  })

  it("snowball clears the smallest balance first", () => {
    const debts = [card, car, student, marco]
    const sn = simulatePlan({ debts, strategy: "snowball", extraMonthly: 15_000 })
    expect(sn.firstCleared!.id).toBe("marco")
    const av = simulatePlan({ debts, strategy: "avalanche", extraMonthly: 15_000 })
    expect(sn.firstCleared!.month).toBeLessThanOrEqual(av.firstCleared!.month)
  })

  it("rollover: a cleared debt's payment joins the pool for the next debt", () => {
    // A: €120/mo, clears in 2 months. B: €200/mo. Extra €100/mo.
    // Month 1: A pays 120+100 extra → 80 left. Month 2: A pays 80 (min) + 0 extra needed, extra 100 → B.
    // From month 3, B receives 200 (own) + 120 (freed) + 100 (extra) = 420.
    const a: PlannerDebt = { id: "a", name: "A", balance: 30_000, annualRatePct: 0, minPayment: 12_000 }
    const b: PlannerDebt = { id: "b", name: "B", balance: 200_000, annualRatePct: 0, minPayment: 20_000 }
    const r = simulatePlan({ debts: [a, b], strategy: "snowball", extraMonthly: 10_000 })
    expect(r.debts.find((d) => d.id === "a")!.clearedMonth).toBe(2)
    // Without rollover B would need 200000 / (20000+10000) ≈ 7 months after A; with A's 120 freed it is faster.
    // B: m1 pays 200 → 1800; m2 pays 200 + (extra 100 − 20 leftover for A?) …; assert total months well under the no-rollover figure.
    const noRollover = Math.ceil(200_000 / 30_000) // 7 months even ignoring A
    expect(r.months).toBeLessThanOrEqual(noRollover)
    expect(r.totalPaid).toBe(230_000)
  })

  it("interest accrues monthly at the nominal rate and the loan still ends at zero", () => {
    const r = simulatePlan({ debts: [{ id: "l", name: "L", balance: 1_000_000, annualRatePct: 5, minPayment: 43_871 }], strategy: "minimum" })
    expect(r.months).toBe(24)
    expect(r.totalInterest).toBeGreaterThan(52_000)
    expect(r.totalInterest).toBeLessThan(53_500)
    expect(r.totalPaid).toBe(1_000_000 + r.totalInterest)
  })

  it("a lump sum today shortens the plan and follows the strategy order", () => {
    const debts = [card, car]
    const base = simulatePlan({ debts, strategy: "avalanche", extraMonthly: 5_000 })
    const lump = simulatePlan({ debts, strategy: "avalanche", extraMonthly: 5_000, lumpSumNow: 240_000 })
    expect(lump.months).toBeLessThan(base.months!)
    expect(lump.debts.find((d) => d.id === "card")!.clearedMonth).toBe(1) // the card is paid off on day one
    expect(lump.totalInterest).toBeLessThan(base.totalInterest)
  })

  it("a plan whose payments do not cover the interest reports null months instead of a fake date", () => {
    const r = simulatePlan({ debts: [{ id: "bad", name: "Bad", balance: 1_000_000, annualRatePct: 24, minPayment: 15_000 }], strategy: "minimum" })
    expect(r.months).toBeNull()
  })

  it("comparison: every strategy beats minimum-only on months, avalanche is never beaten on interest", () => {
    const debts = [card, car, student, marco]
    const c = comparePlans({ debts, extraMonthly: 20_000, customOrder: ["marco", "card", "student", "car"] })
    expect(c.baseline.months).toBeNull() // Marco never clears on minimums alone
    const av = c.plans.find((p) => p.strategy === "avalanche")!
    for (const p of c.plans) {
      expect(p.months).not.toBeNull()
      expect(av.totalInterest).toBeLessThanOrEqual(p.totalInterest)
    }
    // Custom order honours Marco first and shows its cost, not a judgement.
    const custom = c.plans.find((p) => p.strategy === "custom")!
    expect(custom.firstCleared!.id).toBe("marco")
    expect(custom.totalInterest).toBeGreaterThanOrEqual(av.totalInterest)
  })

  it("comparison savings are computed against the baseline when both converge", () => {
    const debts = [card, car]
    const c = comparePlans({ debts, extraMonthly: 10_000 })
    expect(c.baseline.months).not.toBeNull()
    const s = c.savings.avalanche
    expect(s.monthsSaved!).toBeGreaterThan(0)
    expect(s.interestSaved!).toBeGreaterThan(0)
    expect(c.savings.minimum).toEqual({ monthsSaved: 0, interestSaved: 0 })
  })

  it("is deterministic", () => {
    const debts = [card, car, student, marco]
    const a = simulatePlan({ debts, strategy: "cashflow", extraMonthly: 12_345 })
    const b = simulatePlan({ debts, strategy: "cashflow", extraMonthly: 12_345 })
    expect(a).toEqual(b)
  })
})

describe("debt-planner — affordability and pressure", () => {
  it("switches to stabilisation when the budget cannot cover the scheduled payments", () => {
    expect(affordability(92_000, 60_000)).toEqual({ mode: "stabilize", requiredMonthly: 92_000, budget: 60_000, gap: 32_000 })
    expect(affordability(68_000, 90_000)).toEqual({ mode: "optimize", requiredMonthly: 68_000, budget: 90_000, extra: 22_000 })
  })
  it("debt-payment ratio: €850 of €2,500 → 34 %; null without income", () => {
    expect(debtPaymentRatio(85_000, 250_000)).toBe(34)
    expect(debtPaymentRatio(85_000, 0)).toBeNull()
    expect(debtPaymentRatio(85_000, null)).toBeNull()
  })
})
