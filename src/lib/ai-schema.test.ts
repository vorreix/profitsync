/* eslint-disable @typescript-eslint/no-explicit-any -- traversing untyped converted schemas */
import { describe, expect, it } from "vitest"
import { toGeminiSchema, toOpenAiSchema } from "./ai-schema"

const canonical = {
  type: "object",
  additionalProperties: false,
  required: ["reasoning", "amount"],
  properties: {
    reasoning: { type: "string" },
    amount: { type: ["number", "null"], description: "digits only" },
    kind: { type: "string", enum: ["incoming", "outgoing"] },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["amount"],
      properties: { amount: { type: "number" } },
    },
  },
}

describe("toGeminiSchema", () => {
  const g = toGeminiSchema(canonical) as Record<string, any>

  it("converts nullable type arrays to nullable:true", () => {
    expect(g.properties.amount.type).toBe("number")
    expect(g.properties.amount.nullable).toBe(true)
    expect(g.properties.amount.description).toBe("digits only")
  })

  it("drops additionalProperties at every level", () => {
    expect(g.additionalProperties).toBeUndefined()
    expect(g.properties.confidence.additionalProperties).toBeUndefined()
  })

  it("keeps enums, required, and plain types intact", () => {
    expect(g.properties.kind.enum).toEqual(["incoming", "outgoing"])
    expect(g.required).toEqual(["reasoning", "amount"])
    expect(g.properties.reasoning.type).toBe("string")
  })
})

describe("toOpenAiSchema", () => {
  const o = toOpenAiSchema(canonical) as Record<string, any>

  it("keeps type arrays (strict mode supports them)", () => {
    expect(o.properties.amount.type).toEqual(["number", "null"])
  })

  it("requires ALL properties and forbids extras at every level (strict rules)", () => {
    expect(o.required.sort()).toEqual(["amount", "confidence", "kind", "reasoning"])
    expect(o.additionalProperties).toBe(false)
    expect(o.properties.confidence.required).toEqual(["amount"])
    expect(o.properties.confidence.additionalProperties).toBe(false)
  })
})
