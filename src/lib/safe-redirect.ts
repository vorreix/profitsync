// Only allow internal, same-app redirect targets: a path that starts with a
// single "/" and is neither protocol-relative ("//evil.com") nor an absolute
// URL ("https://evil.com"). Anything else returns null so callers fall back to a
// safe default. Prevents open-redirect abuse via the ?redirect= query param.
export function safeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith("/")) return null
  if (raw.startsWith("//")) return null
  if (raw.includes("://")) return null
  return raw
}
