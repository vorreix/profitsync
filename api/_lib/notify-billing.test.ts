import { describe, expect, it } from "vitest"
import { isNoteworthySubscriptionChange } from "./notify-billing.js"

// Pure noteworthy-transition logic only — the send paths need a DB and are
// exercised with throwaway local tests (see docs/notifications/V5_PLAN.md).
describe("isNoteworthySubscriptionChange", () => {
  it("fires on a plan change", () => {
    expect(
      isNoteworthySubscriptionChange({ fromPlan: "free", toPlan: "premium", fromStatus: "active", toStatus: "active" }),
    ).toBe(true)
  })

  it("fires when a checkout completes (pending → active)", () => {
    expect(
      isNoteworthySubscriptionChange({ fromPlan: "premium", toPlan: "premium", fromStatus: "pending", toStatus: "active" }),
    ).toBe(true)
  })

  it("fires on cancellation", () => {
    expect(
      isNoteworthySubscriptionChange({ fromPlan: "premium", toPlan: "premium", fromStatus: "active", toStatus: "cancelled" }),
    ).toBe(true)
  })

  it("stays quiet on no-op updates (webhook renewals)", () => {
    expect(
      isNoteworthySubscriptionChange({ fromPlan: "premium", toPlan: "premium", fromStatus: "active", toStatus: "active" }),
    ).toBe(false)
  })

  it("stays quiet on past_due (payment_failed already alerts)", () => {
    expect(
      isNoteworthySubscriptionChange({ fromPlan: "premium", toPlan: "premium", fromStatus: "active", toStatus: "past_due" }),
    ).toBe(false)
  })

  it("stays quiet when nothing is known", () => {
    expect(
      isNoteworthySubscriptionChange({ fromPlan: null, toPlan: null, fromStatus: null, toStatus: null }),
    ).toBe(false)
  })
})
