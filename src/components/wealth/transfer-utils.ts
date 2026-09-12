import type { Transfer } from "@/lib/types"

/**
 * The machine-readable `code` an API error carried, if any. `apiErrorMessage`
 * gives the human sentence; this is for branching ("already reversed" gets a
 * friendlier line than the server's).
 */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  const m = err.message.trim()
  if (!m.startsWith("{")) return null
  try {
    const j = JSON.parse(m) as { code?: unknown }
    return typeof j.code === "string" ? j.code : null
  } catch {
    return null
  }
}

/** Principal + fee: everything that leaves the source account, as a number. */
export function transferTotalLeaving(t: Pick<Transfer, "source_amount" | "source_fee_amount">): number {
  return Number(t.source_amount) + Number(t.source_fee_amount || 0)
}

export function isCrossCurrency(t: Pick<Transfer, "source_currency" | "destination_currency">): boolean {
  return t.source_currency !== t.destination_currency
}
