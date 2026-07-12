// Pure helpers for the quotation-PDF *history* (up to N rendered PDFs per
// quotation). Import-free on purpose (no DB / no node built-ins) so it is safe
// for the DB-free unit gate and can be reused by the API and any client code.

/** Max rendered PDFs kept (and shown) per quotation. Older ones are pruned. */
export const MAX_PDF_HISTORY = 5

function toTime(v: Date | string | null | undefined): number {
  if (!v) return 0
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/**
 * Split ready PDF rows into the newest `max` to KEEP and the rest to PRUNE,
 * newest-first by `generatedAt`. Rows with no timestamp sort last. Does not
 * mutate the input.
 */
export function partitionPdfHistory<T extends { generatedAt: Date | string | null }>(
  rows: T[],
  max: number = MAX_PDF_HISTORY,
): { keep: T[]; prune: T[] } {
  const sorted = [...rows].sort((a, b) => toTime(b.generatedAt) - toTime(a.generatedAt))
  return { keep: sorted.slice(0, Math.max(0, max)), prune: sorted.slice(Math.max(0, max)) }
}

/**
 * Is the latest ready PDF stale relative to the live content hash? True when
 * there is no PDF yet, or the newest one was rendered from different content —
 * the UI uses this to nudge a regenerate (but never auto-generates).
 */
export function isPdfStale(latestSourceHash: string | null | undefined, currentHash: string): boolean {
  return latestSourceHash == null || latestSourceHash !== currentHash
}
