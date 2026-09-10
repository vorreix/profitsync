// The colour half of a wealth-account write, in one place: /api/wealth/accounts
// (create + patch) and /api/spaces (create + patch) all validate it identically,
// so a Space and a bank can never disagree about what a valid colour is.
//
// The rules themselves live in the pure, tested resolver
// (src/lib/account-color.ts) — this only adapts them to a request body.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { isAccountColorStyle, parseAccountColor } from "../../src/lib/account-color.js"

export type AppearanceInput = {
  color?: unknown
  color_style?: unknown
  colorStyle?: unknown
}

export type AppearancePatch = { color?: string; colorStyle?: string }

/**
 * The appearance columns named in this body, or the exact error to send back.
 *
 * A key that is ABSENT is left out of the patch entirely (so a rename PATCH
 * can't silently reset a colour); `color: ""` / `"auto"` is a deliberate reset
 * to AUTO and is kept.
 */
export function pickAppearance(body: AppearanceInput): { ok: true; patch: AppearancePatch } | { ok: false; error: string } {
  const patch: AppearancePatch = {}
  if ("color" in body) {
    const parsed = parseAccountColor(body.color)
    if (!parsed.ok) return { ok: false, error: "color must be a #RRGGBB hex or empty" }
    patch.color = parsed.value
  }
  const style = "color_style" in body ? body.color_style : "colorStyle" in body ? body.colorStyle : undefined
  if (style !== undefined) {
    if (!isAccountColorStyle(style)) return { ok: false, error: "color_style must be subtle or bold" }
    patch.colorStyle = style
  }
  return { ok: true, patch }
}
