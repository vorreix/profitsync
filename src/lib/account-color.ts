// The colour a wealth account (bank / cash / Space) is painted in.
//
// Credit cards have worn brand colours since the Cards release; the bank and
// Space tiles next to them were all the same grey card surface, so telling two
// banks apart meant reading the name. This module gives every account a colour
// — automatically, before anyone opens a picker — and lets the user override it.
//
// PRESENTATION ONLY. Nothing here is ever read by money maths (docs/cards
// /CARDS.md's "a card is identity, never money" applies to accounts too).
//
// Resolution order (`resolveAccountColor`):
//   1. the user's explicit `color` ("#RRGGBB")
//   2. the bank's curated brand colour, matched on `brand_domain` — the same
//      CURATED_BANK_COLORS table the card visuals use, so an HDFC bank tile and
//      an HDFC card agree
//   3. a stable swatch derived from the row id, so two banks with no brand
//      match are still different colours and never change colour later
// Cash is the one exception: it is the workspace's one permanent account and
// keeps a fixed emerald so it reads as "the wallet" in every workspace.
//
// No React, no DOM, no I/O — every function here is unit-tested in
// account-color.test.ts.

import { curatedBankColor, darken, isHexColor, lighten, normalizeHex, readableTextOn } from "./cards.js"

export type AccountColorStyle = "subtle" | "bold"

export const ACCOUNT_COLOR_STYLES: readonly AccountColorStyle[] = ["subtle", "bold"] as const

export function isAccountColorStyle(v: unknown): v is AccountColorStyle {
  return v === "subtle" || v === "bold"
}

/** The style to use for a row whose column may hold anything (or nothing). */
export function accountColorStyle(v: unknown): AccountColorStyle {
  return isAccountColorStyle(v) ? v : "subtle"
}

/**
 * The swatches offered in the picker — and the pool AUTO draws from.
 *
 * Chosen for two jobs at once: each is dark enough that white text sits on it
 * at AA in "bold", and distinct enough from its neighbours to be told apart at
 * a 3px rail in "subtle". Order is the order they are shown.
 */
export const ACCOUNT_SWATCHES: readonly string[] = [
  "#2563EB", // blue
  "#0EA5E9", // sky
  "#0D9488", // teal
  "#059669", // emerald
  "#65A30D", // lime
  "#CA8A04", // amber
  "#EA580C", // orange
  "#DC2626", // red
  "#DB2777", // pink
  "#9333EA", // violet
  "#4F46E5", // indigo
  "#475569", // slate
] as const

/** Cash in Hand is always the same green — one wallet, every workspace. */
export const CASH_COLOR = "#059669"

/** A Space with no colour of its own wears the savings emerald. */
export const SPACE_COLOR = "#0D9488"

/**
 * A stable index into ACCOUNT_SWATCHES for a row id. FNV-1a over the id: the
 * same account always lands on the same swatch (a colour that changed between
 * loads would be worse than no colour at all), and ids that differ by one
 * character land far apart.
 */
export function swatchForKey(key: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return ACCOUNT_SWATCHES[hash % ACCOUNT_SWATCHES.length]
}

/** The subset of an account this module needs — a DB row or an API row both fit. */
export type AccountColorSource = {
  id?: string | null
  type?: string | null
  color?: string | null
  color_style?: string | null
  brand_domain?: string | null
}

/** Where a resolved colour came from — the picker shows "Auto" differently. */
export type AccountColorSourceKind = "custom" | "brand" | "cash" | "space" | "auto"

export type ResolvedAccountColor = { hex: string; source: AccountColorSourceKind }

/** The colour an account is painted in, and why (see the order at the top). */
export function resolveAccountColor(account: AccountColorSource): ResolvedAccountColor {
  if (isHexColor(account.color)) return { hex: normalizeHex(account.color), source: "custom" }
  if (account.type === "cash") return { hex: CASH_COLOR, source: "cash" }
  const brand = curatedBankColor(account.brand_domain)
  if (brand) return { hex: normalizeHex(brand), source: "brand" }
  if (account.type === "space") return { hex: SPACE_COLOR, source: "space" }
  return { hex: swatchForKey(account.id ?? ""), source: "auto" }
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** `hex` at `alpha` opacity, as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const h = normalizeHex(hex).slice(1)
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`
}

/**
 * The CSS custom properties a coloured surface needs. They are set once on the
 * tile and consumed by account-color.css, which picks the light or dark member
 * of each pair — a 10% wash of navy is invisible on a near-black card, so the
 * dark theme washes with a LIGHTENED copy of the same colour instead.
 *
 * `--acct-*` names (not Tailwind arbitrary values) because the same variables
 * drive the rail, the halo, the wash and the bold gradient together.
 */
export type AccountColorVars = Record<`--acct-${string}`, string>

export function accountColorVars(hex: string): AccountColorVars {
  const base = normalizeHex(hex)
  // The dark theme wears a lifted copy: a #0B4A9B rail disappears against the
  // dark card, and a #1B1C20 brand colour would vanish entirely.
  const lifted = lighten(base, 0.34)
  return {
    "--acct-base": base,
    "--acct-lifted": lifted,
    "--acct-rail-light": base,
    "--acct-rail-dark": lifted,
    "--acct-wash-light": withAlpha(base, 0.1),
    "--acct-wash-dark": withAlpha(lifted, 0.14),
    "--acct-halo-light": withAlpha(base, 0.14),
    "--acct-halo-dark": withAlpha(lifted, 0.2),
    "--acct-ring-light": withAlpha(base, 0.35),
    "--acct-ring-dark": withAlpha(lifted, 0.4),
  }
}

export type BoldSurface = {
  /** Gradient stops for the bold tile. */
  from: string
  to: string
  /** Which text family reads on it. */
  text: "light" | "dark"
  /** Inline style for the tile itself (gradient + the shared variables). */
  style: Record<string, string>
}

/**
 * The "bold" surface: the account's colour, darkened toward the bottom-right so
 * the balance always has contrast — the same treatment `resolveCardPalette`
 * gives a card, so a bold bank tile and its cards look like one family.
 */
export function boldSurface(hex: string): BoldSurface {
  const from = normalizeHex(hex)
  const to = darken(from, 0.45)
  return {
    from,
    to,
    text: readableTextOn(from),
    style: {
      ...accountColorVars(from),
      backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    },
  }
}

export type AccountAppearance = {
  hex: string
  source: AccountColorSourceKind
  style: AccountColorStyle
  /** True when the tile paints itself in the colour rather than accenting it. */
  bold: boolean
  /** Text family on a bold tile ("light" everywhere else). */
  text: "light" | "dark"
  /** Inline style to spread onto the tile element. */
  vars: Record<string, string>
}

/** Everything a tile needs in one call: the colour, the style, and the CSS. */
export function accountAppearance(account: AccountColorSource): AccountAppearance {
  const { hex, source } = resolveAccountColor(account)
  const style = accountColorStyle(account.color_style)
  if (style === "bold") {
    const bold = boldSurface(hex)
    return { hex, source, style, bold: true, text: bold.text, vars: bold.style }
  }
  return { hex, source, style, bold: false, text: "light", vars: accountColorVars(hex) }
}

// ── Write validation (shared by the API routes) ──────────────────────────────

/**
 * Normalise a `color` value coming off the wire: "" / null clears back to AUTO,
 * a valid hex is upper-cased, anything else is rejected so the DB CHECK can
 * never be the thing that fails.
 */
export function parseAccountColor(v: unknown): { ok: true; value: string } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: "" }
  if (typeof v !== "string") return { ok: false }
  const s = v.trim()
  if (s === "" || s === "auto") return { ok: true, value: "" }
  return isHexColor(s) ? { ok: true, value: normalizeHex(s) } : { ok: false }
}
