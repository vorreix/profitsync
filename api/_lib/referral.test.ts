import { describe, expect, it } from "vitest"
import { referralBalances } from "./referral.js"

describe("referralBalances", () => {
  it("never adds rewards across currencies (MC-005)", () => {
    const out = referralBalances(
      [
        { currency: "INR", lifetime: 249.75, eligible: 249.75 },
        { currency: "USD", lifetime: 2.5, eligible: 2.5 },
      ],
      [],
    )
    expect(out).toEqual([
      { currency: "INR", lifetimeEarned: 249.75, eligibleEarned: 249.75, outstanding: 0, pending: 0, available: 249.75 },
      { currency: "USD", lifetimeEarned: 2.5, eligibleEarned: 2.5, outstanding: 0, pending: 0, available: 2.5 },
    ])
  })

  it("subtracts a payout only from the balance in its own currency", () => {
    const out = referralBalances(
      [
        { currency: "INR", lifetime: 300, eligible: 300 },
        { currency: "USD", lifetime: 10, eligible: 10 },
      ],
      [{ currency: "USD", outstanding: 10, pending: 4 }],
    )
    expect(out.find((b) => b.currency === "INR")?.available).toBe(300)
    expect(out.find((b) => b.currency === "USD")).toMatchObject({ available: 0, outstanding: 10, pending: 4 })
  })

  it("keeps money still in holding out of the available balance", () => {
    const [b] = referralBalances([{ currency: "EUR", lifetime: 20, eligible: 5 }], [])
    expect(b).toMatchObject({ lifetimeEarned: 20, eligibleEarned: 5, available: 5 })
  })

  it("never goes negative when claims exceed earnings (legacy mixed-currency payouts)", () => {
    const [b] = referralBalances([{ currency: "USD", lifetime: 2.5, eligible: 2.5 }], [{ currency: "USD", outstanding: 252.25, pending: 0 }])
    expect(b.available).toBe(0)
  })

  it("merges case/whitespace variants of a code and skips money-less groups", () => {
    const out = referralBalances(
      [
        { currency: "usd ", lifetime: 1.1, eligible: 1.1 },
        { currency: "USD", lifetime: 2.2, eligible: 2.2 },
        { currency: "GBP", lifetime: 0, eligible: 0 }, // signed_up only
      ],
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ currency: "USD", lifetimeEarned: 3.3, available: 3.3 })
  })

  it("puts the largest available balance first (the legacy flat fields read it)", () => {
    const out = referralBalances(
      [
        { currency: "USD", lifetime: 5, eligible: 5 },
        { currency: "INR", lifetime: 900, eligible: 900 },
      ],
      [],
    )
    expect(out.map((b) => b.currency)).toEqual(["INR", "USD"])
  })
})
