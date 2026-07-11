// Minimal in-process fixed-window rate limiter.
//
// Per-instance (Vercel function instances don't share memory), so treat the
// limit as a per-instance ceiling against runaway clients — abuse protection,
// not precise quota accounting. Same trade-off as the auth membership cache.
const windows = new Map<string, { count: number; resetAt: number }>()

/**
 * Count one hit for `key`; true while the key stays within `max` hits per
 * `windowMs`. Windows are fixed (reset as a whole), which is fine for the
 * coarse limits this backs.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const w = windows.get(key)
  if (!w || w.resetAt <= now) {
    // Memory backstop: a pathological key cardinality can't grow unbounded.
    if (windows.size >= 10_000) windows.clear()
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return max >= 1
  }
  w.count++
  return w.count <= max
}

/** Test hook: reset all windows. */
export function clearRateLimits(): void {
  windows.clear()
}
