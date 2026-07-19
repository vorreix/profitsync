import { describe, expect, it } from "vitest"
import { baseCost, tokenSurcharge, type AiCreditCosts, type AiTokenPolicy } from "./ai-credits"

const costs: AiCreditCosts = { quickadd: 5, quickaddMedia: 10, assistant: 20 }
const policy: AiTokenPolicy = { includedQuickadd: 3000, includedAssistant: 6000, tokensPerExtraCredit: 1000 }

describe("baseCost", () => {
  it("prices text, media and assistant actions distinctly", () => {
    expect(baseCost("quickadd", false, costs)).toBe(5)
    expect(baseCost("quickadd", true, costs)).toBe(10)
    expect(baseCost("assistant", false, costs)).toBe(20)
    expect(baseCost("assistant", true, costs)).toBe(20)
  })
})

describe("tokenSurcharge", () => {
  it("is free within the included budget", () => {
    expect(tokenSurcharge("quickadd", 0, policy)).toBe(0)
    expect(tokenSurcharge("quickadd", 2999, policy)).toBe(0)
    expect(tokenSurcharge("quickadd", 3000, policy)).toBe(0)
    expect(tokenSurcharge("assistant", 6000, policy)).toBe(0)
  })

  it("charges one credit per started 1000-token block beyond included", () => {
    expect(tokenSurcharge("quickadd", 3001, policy)).toBe(1)
    expect(tokenSurcharge("quickadd", 4000, policy)).toBe(1)
    expect(tokenSurcharge("quickadd", 4001, policy)).toBe(2)
    expect(tokenSurcharge("assistant", 8500, policy)).toBe(3)
  })

  it("tolerates garbage token counts", () => {
    expect(tokenSurcharge("quickadd", Number.NaN, policy)).toBe(0)
    expect(tokenSurcharge("quickadd", -50, policy)).toBe(0)
    expect(tokenSurcharge("quickadd", Number.POSITIVE_INFINITY, policy)).toBe(0)
  })

  it("never divides by zero even with a broken policy", () => {
    expect(tokenSurcharge("quickadd", 5000, { ...policy, tokensPerExtraCredit: 0 })).toBe(2000)
  })
})
