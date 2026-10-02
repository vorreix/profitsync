import { describe, expect, it } from "vitest"
import type { VercelRequest } from "@vercel/node"
import { ruleErrorFor, withRuleError } from "./client-capabilities.js"

const oldBuild = { headers: {} } as VercelRequest
const newBuild = { headers: { "x-client-capabilities": "multi-currency" } } as unknown as VercelRequest
const body = JSON.stringify({ error: "Card is frozen — unfreeze it or pick another card", code: "recurring_card_frozen" })

describe("ruleErrorFor (MC-077)", () => {
  it("gives a pre-multi-currency build the English sentence, a current one the body", () => {
    expect(ruleErrorFor(oldBuild, body)).toBe("Card is frozen — unfreeze it or pick another card")
    expect(ruleErrorFor(newBuild, body)).toBe(body)
  })

  it("passes plain text, empty and unparseable values through either way", () => {
    for (const req of [oldBuild, newBuild]) {
      expect(ruleErrorFor(req, "Account is archived")).toBe("Account is archived")
      expect(ruleErrorFor(req, "")).toBe("")
      expect(ruleErrorFor(req, null)).toBe("")
      expect(ruleErrorFor(req, "{not json")).toBe("{not json")
    }
  })

  it("reshapes a row's lastError and leaves the rest alone", () => {
    expect(withRuleError(oldBuild, { id: "r1", lastError: body })).toEqual({ id: "r1", lastError: "Card is frozen — unfreeze it or pick another card" })
  })
})
