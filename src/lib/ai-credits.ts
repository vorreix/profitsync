// Pure credit-economy math for the AI features. No env access, no imports —
// the API layer feeds env-derived config in, Vitest covers the math directly.
//
// Model: one per-org credit BALANCE (src/lib/db/schema.ts `ai_credits`).
// Free plans receive a ONE-TIME grant; premium refills monthly (no rollover).
// Every action costs a predictable BASE, plus a token SURCHARGE only when the
// provider-reported usage exceeds the tokens included in the base price —
// typical calls stay flat-priced, outliers (huge receipts, long rambling
// audio) pay proportionally.

export type AiCreditCosts = {
  quickadd: number // text-only quick add
  quickaddMedia: number // quick add with a receipt image or voice recording
  assistant: number // a voice-assistant ask
}

export type AiTokenPolicy = {
  includedQuickadd: number // tokens covered by the quick-add base price
  includedAssistant: number // tokens covered by the assistant base price
  tokensPerExtraCredit: number // each started block beyond included costs +1
}

export function baseCost(kind: "quickadd" | "assistant", hasMedia: boolean, costs: AiCreditCosts): number {
  if (kind === "assistant") return costs.assistant
  return hasMedia ? costs.quickaddMedia : costs.quickadd
}

/** Extra credits owed for token usage beyond what the base price includes. */
export function tokenSurcharge(
  kind: "quickadd" | "assistant",
  totalTokens: number,
  policy: AiTokenPolicy,
): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0
  const included = kind === "assistant" ? policy.includedAssistant : policy.includedQuickadd
  const excess = totalTokens - included
  if (excess <= 0) return 0
  return Math.ceil(excess / Math.max(1, policy.tokensPerExtraCredit))
}
