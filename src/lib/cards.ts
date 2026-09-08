// Pure card helpers shared by the client (visuals, chips, wizard validation)
// and the server (defaults, network guessing, autopay preview). No I/O, no
// React, no DOM — everything here is unit-tested in cards.test.ts.
//
// A card never holds money (docs/cards/CARDS.md): these helpers only deal with
// identity (name, number tail, expiry), presentation (palette) and the small
// amount of scheduling logic autopay needs.

import type { BrandColor, CardDesign, CardKind, CardNetwork, CardPattern, CardTier } from "./types.js"

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const CARD_NETWORKS: readonly CardNetwork[] = ["visa", "mastercard", "amex", "rupay", "discover", "jcb", "unionpay", "maestro", "diners", "other"] as const
export const CARD_TIERS: readonly CardTier[] = ["standard", "gold", "platinum", "metal", "black", "custom"] as const
export const CARD_PATTERNS: readonly CardPattern[] = ["none", "waves", "mesh", "dots"] as const

export const NETWORK_LABEL: Record<CardNetwork, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  rupay: "RuPay",
  discover: "Discover",
  jcb: "JCB",
  unionpay: "UnionPay",
  maestro: "Maestro",
  diners: "Diners Club",
  other: "Card",
}

export function isCardNetwork(v: unknown): v is CardNetwork {
  return typeof v === "string" && (CARD_NETWORKS as readonly string[]).includes(v)
}
export function isCardTier(v: unknown): v is CardTier {
  return typeof v === "string" && (CARD_TIERS as readonly string[]).includes(v)
}
export function isCardPattern(v: unknown): v is CardPattern {
  return typeof v === "string" && (CARD_PATTERNS as readonly string[]).includes(v)
}
export function isCardKind(v: unknown): v is CardKind {
  return v === "debit" || v === "credit"
}

/** Guess the network from free text ("HDFC Visa Platinum" → visa). */
export function guessNetworkFromName(text: string | null | undefined): CardNetwork {
  const s = (text ?? "").toLowerCase()
  if (/\bvisa\b/.test(s)) return "visa"
  if (/master\s?card|\bmc\b/.test(s)) return "mastercard"
  if (/\bamex\b|american express/.test(s)) return "amex"
  if (/\brupay\b/.test(s)) return "rupay"
  if (/\bdiscover\b/.test(s)) return "discover"
  if (/\bjcb\b/.test(s)) return "jcb"
  if (/union\s?pay/.test(s)) return "unionpay"
  if (/\bmaestro\b/.test(s)) return "maestro"
  if (/\bdiners\b/.test(s)) return "diners"
  return "other"
}

// ── Identity ─────────────────────────────────────────────────────────────────

// Loose on purpose: DB rows carry `kind`/`network` as plain strings.
export type CardNameSource = { name: string; network: string; kind: string; account_bank_name?: string | null }

/** The name a card is shown under: its nickname, else "<Bank> <Network>" ("Federal Visa"), else "Visa card". */
export function cardDisplayName(card: CardNameSource): string {
  const nick = (card.name ?? "").trim()
  if (nick) return nick
  const bank = (card.account_bank_name ?? "").trim()
  const known = isCardNetwork(card.network) && card.network !== "other" ? NETWORK_LABEL[card.network] : null
  const net = known ?? (card.kind === "credit" ? "Credit card" : "Debit card")
  return bank ? `${bank} ${net}` : net
}

/** How many trailing digits of a card number may be kept (see migration 0064). */
export const CARD_TAIL_MIN = 4
export const CARD_TAIL_MAX = 6

const TAIL_RE = /^\d{4,6}$/

/** The stored tail, or "" when it is unknown/invalid. */
export function cardTail(last4: string | null | undefined): string {
  const tail = (last4 ?? "").trim()
  return TAIL_RE.test(tail) ? tail : ""
}

/** "•••• 1234" / "•••• 123456" (or "••••" when the tail is unknown). */
export function maskedTail(last4: string | null | undefined): string {
  const tail = cardTail(last4)
  return tail ? `•••• ${tail}` : "••••"
}

/**
 * The full masked number line on the visual. A 16-digit card is shown as four
 * groups; the known tail fills the last group(s), so 4 digits give
 * "•••• •••• •••• 1234" and 6 give "•••• •••• ••12 3456".
 */
export function maskedNumber(last4: string | null | undefined): string {
  const tail = cardTail(last4)
  if (!tail) return "•••• •••• •••• ••••"
  const digits = "•".repeat(16 - tail.length) + tail
  return (digits.match(/.{1,4}/g) ?? []).join(" ")
}

/** Validate a typed number tail: 4 to 6 digits, or empty (unknown). */
export function isValidLast4(v: string): boolean {
  return v === "" || TAIL_RE.test(v)
}

// ── Expiry ───────────────────────────────────────────────────────────────────

/** "MM/YY" for the visual; "" when unknown. */
export function expiryLabel(month: number | null | undefined, year: number | null | undefined): string {
  if (!month || !year) return ""
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`
}

/** A card is valid THROUGH the last day of its expiry month. */
export function expiryEndIso(month: number, year: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
}

export function isCardExpired(month: number | null | undefined, year: number | null | undefined, todayIso: string): boolean {
  if (!month || !year) return false
  return todayIso > expiryEndIso(month, year)
}

/** Expires within `days` (default 30) — and not expired yet. */
export function cardExpiresSoon(month: number | null | undefined, year: number | null | undefined, todayIso: string, days = 30): boolean {
  if (!month || !year) return false
  const end = Date.parse(`${expiryEndIso(month, year)}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  const diff = Math.round((end - today) / 86_400_000)
  return diff >= 0 && diff <= days
}

/** Parse "MM/YY" or "MM/YYYY" typed by a user. */
export function parseExpiry(input: string): { month: number; year: number } | null {
  const m = input.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!m) return null
  const month = Number(m[1])
  let year = Number(m[2])
  if (m[2].length === 2) year += 2000
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null
  return { month, year }
}

// ── Colour maths ─────────────────────────────────────────────────────────────

const HEX_RE = /^#?([0-9a-f]{6})$/i

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim())
}

export function normalizeHex(v: string): string {
  const m = v.trim().match(HEX_RE)
  return m ? `#${m[1].toUpperCase()}` : "#000000"
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Which text colour reads on this background. Dark text only on genuinely light surfaces. */
export function readableTextOn(hex: string): "light" | "dark" {
  return relativeLuminance(hex) > 0.42 ? "dark" : "light"
}

/** Mix `hex` toward black (`amount` 0..1). */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const k = 1 - Math.max(0, Math.min(1, amount))
  return rgbToHex([r * k, g * k, b * k])
}

/** Mix `hex` toward white (`amount` 0..1). */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const k = Math.max(0, Math.min(1, amount))
  return rgbToHex([r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k])
}

// ── Brand palettes ───────────────────────────────────────────────────────────

/**
 * Pick the colour a card should be painted in from a Brandfetch palette:
 * a `brand` colour that is neither near-white nor near-black, else an `accent`,
 * else the darkest usable one. Null when nothing usable.
 */
export function primaryBrandColor(colors: BrandColor[] | null | undefined): string | null {
  if (!colors?.length) return null
  const usable = colors.filter((c) => isHexColor(c.hex)).map((c) => ({ ...c, hex: normalizeHex(c.hex), lum: relativeLuminance(c.hex) }))
  const midTone = (c: { lum: number }) => c.lum > 0.02 && c.lum < 0.6
  const byType = (type: string) => usable.find((c) => c.type === type && midTone(c))
  return (
    byType("brand")?.hex ??
    byType("accent")?.hex ??
    byType("dark")?.hex ??
    usable.filter(midTone).sort((a, b) => a.lum - b.lum)[0]?.hex ??
    null
  )
}

/**
 * Curated fallback colours for well-known banks (used only when Brandfetch has
 * no palette). Keyed by domain; matched by suffix so "www.hdfcbank.com" works.
 */
export const CURATED_BANK_COLORS: Readonly<Record<string, string>> = {
  // India
  "hdfcbank.com": "#004B8B",
  "icicibank.com": "#F58220",
  "sbi.co.in": "#22409A",
  "onlinesbi.sbi": "#22409A",
  "axisbank.com": "#97144D",
  "kotak.com": "#ED1C24",
  "federalbank.co.in": "#0B4A9B",
  "southindianbank.com": "#8B1A1A",
  "canarabank.com": "#00A0DE",
  "bankofbaroda.in": "#F26522",
  "pnbindia.in": "#A20E37",
  "indusind.com": "#8B1E3F",
  "yesbank.in": "#0B4EA2",
  "idfcfirstbank.com": "#9C1D26",
  "unionbankofindia.co.in": "#D71920",
  "bankofindia.co.in": "#1F4E9C",
  "indianbank.in": "#0057A8",
  "kvb.co.in": "#005DAA",
  "cityunionbank.com": "#A6192E",
  "rblbank.com": "#1D3F8F",
  "aubank.in": "#F47920",
  "paytmbank.com": "#00BAF2",
  "csb.co.in": "#003F87",
  "dhanbank.com": "#B7231F",
  "bandhanbank.com": "#E31E24",
  // Italy
  "intesasanpaolo.com": "#1C7B5A",
  "unicredit.it": "#E2001A",
  "unicredit.eu": "#E2001A",
  "bper.it": "#0A4E8B",
  "bancobpm.it": "#0F7B3F",
  "mps.it": "#7B1E3A",
  "bancamediolanum.it": "#1B3F8F",
  "finecobank.com": "#1F4D8F",
  "credem.it": "#0F5A2D",
  "poste.it": "#0047BB",
  "ing.it": "#FF6200",
  "bancasella.it": "#2B3C8F",
  "creditagricole.it": "#009C82",
  // Germany
  "deutsche-bank.de": "#0018A8",
  "db.com": "#0018A8",
  "commerzbank.de": "#FFCC00",
  "sparkasse.de": "#E1001A",
  "vr.de": "#0066B3",
  "dkb.de": "#158CC7",
  "ing.de": "#FF6200",
  "n26.com": "#36A18B",
  "postbank.de": "#FFCC00",
  "hypovereinsbank.de": "#E2001A",
  "comdirect.de": "#FFD400",
  "consorsbank.de": "#009EE0",
  "targobank.de": "#0069B4",
  // UAE / Gulf
  "emiratesnbd.com": "#003A70",
  "adcb.com": "#D80000",
  "bankfab.com": "#0F2E6B",
  "mashreqbank.com": "#F26522",
  "mashreq.com": "#F26522",
  "dib.ae": "#0C6B58",
  "rakbank.ae": "#E4002B",
  "adib.ae": "#0A4C8B",
  "cbd.ae": "#00457C",
  // UK
  "barclays.co.uk": "#00AEEF",
  "barclays.com": "#00AEEF",
  "hsbc.co.uk": "#DB0011",
  "hsbc.com": "#DB0011",
  "lloydsbank.com": "#006A4D",
  "natwest.com": "#42145F",
  "santander.co.uk": "#EC0000",
  "monzo.com": "#FF4F40",
  "starlingbank.com": "#6935D3",
  "revolut.com": "#191C1F",
  "wise.com": "#163300",
  // US
  "chase.com": "#117ACA",
  "bankofamerica.com": "#E31837",
  "wellsfargo.com": "#D71E28",
  "citi.com": "#003B70",
  "capitalone.com": "#004977",
  "usbank.com": "#0C2074",
  "americanexpress.com": "#016FD0",
  "discover.com": "#FF6000",
  "pnc.com": "#F58025",
  "td.com": "#54B948",
  "ally.com": "#650360",
  // Global / fintech
  "paypal.com": "#003087",
  "sc.com": "#0072AA",
  "citibank.com": "#003B70",
  "hsbc.co.in": "#DB0011",
  "dbs.com": "#E31E24",
}

/** Curated colour for a bank domain (suffix match), or null. */
export function curatedBankColor(domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (!d) return null
  if (CURATED_BANK_COLORS[d]) return CURATED_BANK_COLORS[d]
  const hit = Object.keys(CURATED_BANK_COLORS).find((k) => d === k || d.endsWith(`.${k}`))
  return hit ? CURATED_BANK_COLORS[hit] : null
}

// ── Palette resolution ───────────────────────────────────────────────────────

export type CardPalette = {
  from: string
  to: string
  /** Text/foreground colour family that reads on the surface. */
  text: "light" | "dark"
  /** Accent used for the holder name / labels (gold on black, etc.). */
  accent: string
  /** Surface treatment drawn over the gradient. */
  texture: "none" | "metallic" | "brushed" | "matte"
  pattern: CardPattern
  /** Where the colours came from — the UI can say "Using Federal Bank colours". */
  source: "custom" | "tier" | "brand" | "curated" | "default"
}

const DEFAULT_FROM = "#2F3A56"

export const TIER_PALETTES: Readonly<Record<Exclude<CardTier, "standard" | "custom">, Omit<CardPalette, "pattern" | "source">>> = {
  gold: { from: "#D4AF37", to: "#8A6A0F", text: "dark", accent: "#3A2A05", texture: "metallic" },
  platinum: { from: "#E6E8EC", to: "#9CA3AF", text: "dark", accent: "#1F2937", texture: "metallic" },
  metal: { from: "#5B6069", to: "#22252B", text: "light", accent: "#E5E7EB", texture: "brushed" },
  black: { from: "#1B1C20", to: "#050506", text: "light", accent: "#D4AF37", texture: "matte" },
}

export type PaletteInput = {
  tier: CardTier | string | null | undefined
  design?: Partial<CardDesign> | null
  brand_colors?: BrandColor[] | null
  /** The linked bank's domain (curated fallback). */
  brand_domain?: string | null
}

/**
 * The colours a card is painted in. Custom designs win; gold/platinum/metal/
 * black are fixed metallic looks; "standard" wears the bank's brand colour
 * (Brandfetch palette → curated table → a neutral navy), darkened toward the
 * bottom-right so a white wordmark always has contrast.
 */
export function resolveCardPalette(input: PaletteInput): CardPalette {
  const tier = isCardTier(input.tier) ? input.tier : "standard"
  if (tier === "custom" && input.design && isHexColor(input.design.from)) {
    const from = normalizeHex(input.design.from)
    const to = isHexColor(input.design.to) ? normalizeHex(input.design.to) : darken(from, 0.45)
    const text = input.design.text === "dark" || input.design.text === "light" ? input.design.text : readableTextOn(from)
    return {
      from,
      to,
      text,
      accent: text === "light" ? "#FFFFFF" : "#111827",
      texture: "none",
      pattern: isCardPattern(input.design.pattern) ? input.design.pattern : "none",
      source: "custom",
    }
  }
  if (tier !== "standard" && tier !== "custom") {
    return { ...TIER_PALETTES[tier], pattern: "none", source: "tier" }
  }
  const brand = primaryBrandColor(input.brand_colors)
  const curated = brand ? null : curatedBankColor(input.brand_domain)
  const from = brand ?? curated ?? DEFAULT_FROM
  const text = readableTextOn(from)
  return {
    from,
    to: darken(from, 0.5),
    text,
    accent: text === "light" ? "#FFFFFF" : "#111827",
    texture: "none",
    pattern: "none",
    source: brand ? "brand" : curated ? "curated" : "default",
  }
}

/** Sanitize a user-supplied custom design (unknown/invalid → null). */
export function sanitizeCardDesign(input: unknown): CardDesign | null {
  if (!input || typeof input !== "object") return null
  const d = input as Record<string, unknown>
  if (!isHexColor(d.from)) return null
  const from = normalizeHex(d.from)
  const to = isHexColor(d.to) ? normalizeHex(d.to) : darken(from, 0.45)
  const text = d.text === "dark" || d.text === "light" ? d.text : readableTextOn(from)
  const pattern = isCardPattern(d.pattern) ? d.pattern : "none"
  return { from, to, text, pattern }
}

// ── Autopay ──────────────────────────────────────────────────────────────────

export type AutopayStatementInput = {
  id: string
  due_date: string
  remaining: number
  autopay_status: string | null
}

export type AutopayCardInput = {
  autopay: boolean
  autopay_since: string | null
  funding_account_id: string | null
  status: string
}

/**
 * Is this statement one autopay will (or would have) paid? True when autopay is
 * on with a funding bank, the card is not closed (a FROZEN card blocks new
 * purchases, not paying what is owed), the statement still has something to
 * pay, it was never attempted, and it falls due strictly AFTER the day autopay
 * was switched on — a statement already due when the user enabled autopay may
 * well have been paid at the bank already, so it stays theirs to settle.
 */
export function autopayEligible(card: AutopayCardInput, statement: AutopayStatementInput): boolean {
  if (!card.autopay || !card.funding_account_id || card.status === "closed") return false
  if (statement.autopay_status) return false
  if (statement.remaining <= 0) return false
  if (card.autopay_since && statement.due_date <= card.autopay_since) return false
  return true
}

/** Is the eligible statement due (autopay should run now)? */
export function autopayDue(statement: Pick<AutopayStatementInput, "due_date">, todayIso: string): boolean {
  return statement.due_date <= todayIso
}

/**
 * Which statement autopay pays when several are eligible at once (the app was
 * not opened for a while): ONLY the newest — a later statement's balance
 * already contains every older unpaid amount (FIFO, docs/credit-cards §2.3), so
 * paying each one would pay the same debt twice. The older ones are superseded.
 */
export function autopayPlan(card: AutopayCardInput, statements: AutopayStatementInput[], todayIso: string): { pay: AutopayStatementInput | null; supersede: AutopayStatementInput[] } {
  const due = statements
    .filter((s) => autopayEligible(card, s) && autopayDue(s, todayIso))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  if (due.length === 0) return { pay: null, supersede: [] }
  const pay = due[due.length - 1]
  return { pay, supersede: due.slice(0, -1) }
}

/**
 * How much autopay actually moves: the statement's remaining, but never more
 * than the card owes right now (a mistyped onboarding statement, or a payment
 * the user recorded before the close, must not push the card into credit).
 */
export function autopayAmount(remaining: number, currentDebt: number): number {
  return Math.max(0, Math.round(Math.min(remaining, currentDebt) * 100) / 100)
}

/** What the UI shows as "Next autopay": the newest eligible statement's due date + what would be paid. */
export function autopayPreview(card: AutopayCardInput, statements: AutopayStatementInput[], currentDebt?: number): { date: string; amount: number; statement_id: string } | null {
  const eligible = statements.filter((s) => autopayEligible(card, s)).sort((a, b) => a.due_date.localeCompare(b.due_date))
  // The soonest one is what pays next; if several are already due, the newest
  // due one is what the engine will pay (autopayPlan) — preview that instead.
  const next = eligible[0]
  if (!next) return null
  const amount = currentDebt === undefined ? next.remaining : autopayAmount(next.remaining, currentDebt)
  return { date: next.due_date, amount: Math.round(amount * 100) / 100, statement_id: next.id }
}
