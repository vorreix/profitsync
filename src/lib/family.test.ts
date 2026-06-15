import { describe, it, expect } from "vitest"
import { accountTypeAllows } from "./types"
import {
  familyRoleFromOrgRole,
  orgRoleForFamilyRole,
  isHead,
  sumContributionsByMember,
} from "./family"

describe("accountTypeAllows — family", () => {
  it("family: members + spaces + family hub yes; clients/quotations no", () => {
    expect(accountTypeAllows("family", "members")).toBe(true)
    expect(accountTypeAllows("family", "spaces")).toBe(true)
    expect(accountTypeAllows("family", "family")).toBe(true)
    expect(accountTypeAllows("family", "clients")).toBe(false)
    expect(accountTypeAllows("family", "quotations")).toBe(false)
  })

  it("personal/business unchanged; the family hub is family-only", () => {
    expect(accountTypeAllows("personal", "members")).toBe(false)
    expect(accountTypeAllows("personal", "clients")).toBe(false)
    expect(accountTypeAllows("personal", "spaces")).toBe(true)
    expect(accountTypeAllows("business", "spaces")).toBe(false)
    expect(accountTypeAllows("business", "clients")).toBe(true)
    expect(accountTypeAllows("personal", "family")).toBe(false)
    expect(accountTypeAllows("business", "family")).toBe(false)
  })

  it("legacy/null orgs default to the full business experience", () => {
    expect(accountTypeAllows(null, "clients")).toBe(true)
    expect(accountTypeAllows(null, "members")).toBe(true)
    expect(accountTypeAllows(null, "spaces")).toBe(false)
    expect(accountTypeAllows(undefined, "family")).toBe(false)
  })
})

describe("family role mapping", () => {
  it("maps org roles to family roles", () => {
    expect(familyRoleFromOrgRole("owner")).toBe("head")
    expect(familyRoleFromOrgRole("admin")).toBe("head")
    expect(familyRoleFromOrgRole("editor")).toBe("member")
    expect(familyRoleFromOrgRole("viewer")).toBe("viewer")
  })

  it("maps family roles to org roles (round-trip safe for head/member/viewer)", () => {
    expect(orgRoleForFamilyRole("head")).toBe("owner")
    expect(orgRoleForFamilyRole("member")).toBe("editor")
    expect(orgRoleForFamilyRole("viewer")).toBe("viewer")
  })

  it("isHead recognises owner/admin only", () => {
    expect(isHead("owner")).toBe(true)
    expect(isHead("admin")).toBe(true)
    expect(isHead("editor")).toBe(false)
    expect(isHead("viewer")).toBe(false)
  })
})

describe("sumContributionsByMember", () => {
  it("aggregates contributions (in) and disbursements (out) per member", () => {
    const result = sumContributionsByMember([
      { familyPartyUserId: "u_alex", type: "incoming", amount: "100.00" },
      { familyPartyUserId: "u_alex", type: "incoming", amount: 50 },
      { familyPartyUserId: "u_sam", type: "incoming", amount: "200" },
      { familyPartyUserId: "u_sam", type: "outgoing", amount: "30" }, // allowance back to Sam
      { familyPartyUserId: null, type: "incoming", amount: "999" }, // ignored (no member)
    ])
    expect(result).toEqual([
      { userId: "u_sam", contributed: 200, received: 30, net: 170 },
      { userId: "u_alex", contributed: 150, received: 0, net: 150 },
    ])
  })

  it("returns empty for no attributed legs", () => {
    expect(sumContributionsByMember([{ familyPartyUserId: null, type: "incoming", amount: 5 }])).toEqual([])
  })
})
