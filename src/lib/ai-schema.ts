// Pure schema-dialect converters for the AI quick-add feature. The canonical
// output schema (api/_lib/ai.ts) is written in standard JSON Schema with
// nullable unions like `type: ["number", "null"]`. Each provider speaks a
// slightly different dialect; these converters are pure so Vitest covers them
// without touching the API layer.

type JsonSchema = {
  type?: string | string[]
  enum?: unknown[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean
  [key: string]: unknown
}

/**
 * Gemini's responseSchema dialect (OpenAPI-flavored): no type arrays — nullable
 * unions become `type: "X", nullable: true` — and no `additionalProperties`.
 * Everything else we use (object/string/number/enum/required) maps 1:1.
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties") continue
    out[k] = v
  }
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((t) => t !== "null")
    out.type = nonNull[0] ?? "string"
    if (schema.type.includes("null")) out.nullable = true
  }
  if (schema.properties) {
    const props: Record<string, unknown> = {}
    for (const [name, sub] of Object.entries(schema.properties)) props[name] = toGeminiSchema(sub)
    out.properties = props
  }
  if (schema.items) out.items = toGeminiSchema(schema.items)
  return out
}

/**
 * OpenAI strict structured outputs: standard JSON Schema, but every object
 * needs `additionalProperties: false` and ALL properties listed in `required`
 * (nullability expressed via type arrays, which OpenAI supports).
 */
export function toOpenAiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema }
  if (schema.properties) {
    const props: Record<string, unknown> = {}
    for (const [name, sub] of Object.entries(schema.properties)) props[name] = toOpenAiSchema(sub)
    out.properties = props
    out.required = Object.keys(schema.properties)
    out.additionalProperties = false
  }
  if (schema.items) out.items = toOpenAiSchema(schema.items)
  return out
}
