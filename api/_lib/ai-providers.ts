import Anthropic from "@anthropic-ai/sdk"
import { toGeminiSchema, toOpenAiSchema } from "../../src/lib/ai-schema.js"

// ── Multi-provider adapter layer for AI quick add ───────────────────────────
// One canonical request shape in, raw JSON text out. Provider + model are
// CONFIG, not code:
//   AI_PROVIDER=anthropic|gemini|openai   (default: first provider with a key,
//                                          in that order)
//   AI_PARSE_MODEL=<model id>             (default: per-provider below)
// Keys: ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY.
// Voice input requires a provider that accepts raw audio in the same call —
// currently Gemini (and OpenAI audio-capable models); Anthropic is text+image.

export type ProviderName = "anthropic" | "gemini" | "openai"

export type MediaPart = { data: string; media_type: string }

export type ProviderRequest = {
  system: string
  text: string
  image?: MediaPart
  audio?: MediaPart
  // Canonical JSON Schema (type arrays for nullability); converted per dialect.
  schema: Record<string, unknown>
  maxTokens: number
}

const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-3.1-flash-lite",
  openai: "gpt-5.4-mini",
}

const KEY_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
}

export type ResolvedProvider = {
  name: ProviderName
  model: string
  apiKey: string
  supportsAudio: boolean
}

/** The active provider, or null when no provider is configured. */
export function resolveProvider(): ResolvedProvider | null {
  const order: ProviderName[] = ["anthropic", "gemini", "openai"]
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase() as ProviderName | ""
  const name = explicit && order.includes(explicit as ProviderName)
    ? (explicit as ProviderName)
    : order.find((p) => process.env[KEY_ENV[p]])
  if (!name) return null
  const apiKey = process.env[KEY_ENV[name]]
  if (!apiKey) return null
  return {
    name,
    model: process.env.AI_PARSE_MODEL || DEFAULT_MODEL[name],
    apiKey,
    // Anthropic has no audio input; OpenAI mini-tier text models don't accept
    // raw audio either — Gemini is the single-call audio path.
    supportsAudio: name === "gemini",
  }
}

class UnparseableError extends Error {
  code = "unparseable" as const
}

/** Run one structured-extraction call; returns the model's raw JSON text. */
export async function callProvider(p: ResolvedProvider, req: ProviderRequest): Promise<string> {
  switch (p.name) {
    case "anthropic": return callAnthropic(p, req)
    case "gemini": return callGemini(p, req)
    case "openai": return callOpenAi(p, req)
  }
}

async function callAnthropic(p: ResolvedProvider, req: ProviderRequest): Promise<string> {
  const client = new Anthropic({ apiKey: p.apiKey })
  const content: Anthropic.ContentBlockParam[] = []
  if (req.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: req.image.media_type as "image/jpeg", data: req.image.data },
    })
  }
  content.push({ type: "text", text: req.text })
  const response = await client.messages.create({
    model: p.model,
    max_tokens: req.maxTokens,
    system: req.system,
    output_config: { format: { type: "json_schema", schema: req.schema } },
    messages: [{ role: "user", content }],
  })
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")
  if (!textBlock) throw new UnparseableError("empty anthropic response")
  return textBlock.text
}

async function callGemini(p: ResolvedProvider, req: ProviderRequest): Promise<string> {
  const parts: Record<string, unknown>[] = []
  if (req.image) parts.push({ inline_data: { mime_type: req.image.media_type, data: req.image.data } })
  if (req.audio) parts.push({ inline_data: { mime_type: req.audio.media_type, data: req.audio.data } })
  parts.push({ text: req.text })

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": p.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(req.schema),
          maxOutputTokens: req.maxTokens,
          // Thinking config is GENERATION-SPECIFIC: 2.5 models take
          // thinkingBudget (0 = off; keeps latency/cost down on this tiny
          // extraction task), 3.x models use thinkingLevel instead and the
          // lite tiers may not accept a thinking config at all — so we only
          // send it where it's verified to work.
          ...(p.model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`gemini ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = json.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ?? ""
  if (!text.trim()) throw new UnparseableError("empty gemini response")
  return text
}

async function callOpenAi(p: ResolvedProvider, req: ProviderRequest): Promise<string> {
  const userContent: Record<string, unknown>[] = []
  if (req.image) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${req.image.media_type};base64,${req.image.data}` },
    })
  }
  userContent.push({ type: "text", text: req.text })

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      max_completion_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "transaction_parse", strict: true, schema: toOpenAiSchema(req.schema) },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`openai ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = json.choices?.[0]?.message?.content ?? ""
  if (!text.trim()) throw new UnparseableError("empty openai response")
  return text
}
