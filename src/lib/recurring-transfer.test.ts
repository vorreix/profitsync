import { describe, it, expect } from "vitest"
import { buildRecurringTransferLegs } from "./recurring-transfer"

const rule = {
  id: "rule-1",
  wealthAccountId: "src-acct",
  toAccountId: "space-acct",
  amount: "200",
  name: "Auto-save to Vacation",
  createdBy: "user-1",
}

describe("buildRecurringTransferLegs", () => {
  const legs = buildRecurringTransferLegs(rule, "client-1", "2026-07-01", "grp-1")

  it("anchors idempotency on the OUTGOING leg only", () => {
    expect(legs.outLeg.recurringRuleId).toBe("rule-1")
    expect(legs.outLeg.recurringDueDate).toBe("2026-07-01")
    // the incoming Space leg must NOT carry recurring keys (else the unique index double-conflicts)
    expect(legs.inLeg.recurringRuleId).toBeUndefined()
    expect(legs.inLeg.recurringDueDate).toBeUndefined()
  })

  it("moves money OUT of the source and INTO the Space", () => {
    expect(legs.outLeg.wealthAccountId).toBe("src-acct")
    expect(legs.outLeg.type).toBe("outgoing")
    expect(legs.inLeg.wealthAccountId).toBe("space-acct")
    expect(legs.inLeg.type).toBe("incoming")
  })

  it("balance deltas net to zero (transfer-neutral): −amount source, +amount dest", () => {
    expect(legs.sourceDelta).toBe(-200)
    expect(legs.destDelta).toBe(200)
    expect(legs.sourceDelta + legs.destDelta).toBe(0)
  })

  it("both legs share the group_id and are tagged kind='transfer'", () => {
    expect(legs.outLeg.groupId).toBe("grp-1")
    expect(legs.inLeg.groupId).toBe("grp-1")
    expect(legs.outLeg.kind).toBe("transfer")
    expect(legs.inLeg.kind).toBe("transfer")
  })

  it("formats the amount to 2 decimals on both legs", () => {
    const l = buildRecurringTransferLegs({ ...rule, amount: 33.3 }, "c", "2026-07-01", "g")
    expect(l.outLeg.amount).toBe("33.30")
    expect(l.inLeg.amount).toBe("33.30")
  })
})
