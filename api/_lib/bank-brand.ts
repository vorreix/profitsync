// Bank brand lookup + logo fetching. Best-effort and FREE-tier friendly:
// autocomplete uses the Brandfetch Brand Search API (the project's existing key),
// and logo fetching degrades through Brandfetch's CDN → Google's favicon service
// → DuckDuckGo's icon service (the last two need no key and are unlimited). Every
// path fails soft: a missing logo never blocks creating/updating an account.

import { sniffImageMime } from "../../src/lib/logo-data.js"

const BRANDFETCH_KEY = process.env.BRANDFETCH_APIKEY ?? ""

export type BrandResult = { name: string; domain: string; icon: string }

function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// Only fetch logo images from known, public logo/favicon hosts over HTTPS. The
// logo URL can originate from the client (the chosen brand), so this prevents
// SSRF (e.g. pointing it at internal services or cloud metadata endpoints).
const ALLOWED_LOGO_HOSTS = new Set([
  "cdn.brandfetch.io",
  "asset.brandfetch.io",
  "www.google.com",
  "icons.duckduckgo.com",
  "img.logo.dev",
  "logo.clearbit.com",
])

function isSafeLogoUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "https:" && ALLOWED_LOGO_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/**
 * Autocomplete bank names → candidates with a resolved domain + logo URL. Returns
 * [] (never throws) when the key is missing or the upstream is unavailable, so
 * the bank-name field still works as plain free text.
 */
export async function searchBrands(query: string): Promise<BrandResult[]> {
  const q = query.trim()
  if (!q || !BRANDFETCH_KEY) return []
  const base = `https://api.brandfetch.io/v2/search/${encodeURIComponent(q)}`
  // The key works either as a Bearer token or as the `?c=` client id depending on
  // how the Brandfetch account is set up — try both.
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    { url: base, headers: { Authorization: `Bearer ${BRANDFETCH_KEY}` } },
    { url: `${base}?c=${encodeURIComponent(BRANDFETCH_KEY)}`, headers: {} },
  ]
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, { headers: attempt.headers }, 4500)
      if (!res.ok) continue
      const data = (await res.json()) as Array<{ name?: string; domain?: string; icon?: string; logo?: string }>
      if (!Array.isArray(data)) continue
      const mapped = data
        .map((d) => ({ name: String(d.name ?? d.domain ?? ""), domain: String(d.domain ?? ""), icon: String(d.icon ?? d.logo ?? "") }))
        .filter((d) => d.domain)
      if (mapped.length) return mapped.slice(0, 8)
    } catch {
      /* try the next auth style */
    }
  }
  return []
}

// ── Brand palette (cards) ────────────────────────────────────────────────────

export type BrandPalette = {
  /** Brandfetch colours: [{ hex, type: 'brand'|'accent'|'dark'|'light'|…, brightness }] */
  colors: { hex: string; type: string; brightness?: number }[]
  /** Wordmark logo URL for a DARK surface (light-coloured logo), if any. */
  logo_dark_url: string
  /** Wordmark logo URL for a LIGHT surface (dark-coloured logo), if any. */
  logo_light_url: string
}

// Per-process cache: a domain's palette barely changes and the card wizard may
// resolve the same bank several times in a session. Bounded like the auth cache.
const paletteCache = new Map<string, { at: number; value: BrandPalette | null }>()
const PALETTE_TTL_MS = 6 * 60 * 60 * 1000
const PALETTE_CACHE_MAX = 200

/**
 * The colours (+ themed wordmarks) a bank is known by, from Brandfetch's Brand
 * API. Best-effort: null when the key is missing, the domain is unknown, or the
 * upstream is slow — a card is created without a palette and the visual falls
 * back to the curated table / a neutral look (src/lib/cards.ts).
 */
export async function fetchBrandPalette(domain: string): Promise<BrandPalette | null> {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (!d || !BRANDFETCH_KEY || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null
  const hit = paletteCache.get(d)
  if (hit && Date.now() - hit.at < PALETTE_TTL_MS) return hit.value

  let value: BrandPalette | null = null
  try {
    const res = await fetchWithTimeout(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(d)}`, { headers: { Authorization: `Bearer ${BRANDFETCH_KEY}` } }, 4500)
    if (res.ok) {
      const data = (await res.json()) as {
        colors?: { hex?: string; type?: string; brightness?: number }[]
        logos?: { type?: string; theme?: string; formats?: { src?: string; format?: string }[] }[]
      }
      const colors = (data.colors ?? [])
        .filter((c) => typeof c.hex === "string" && /^#?[0-9a-f]{6}$/i.test(c.hex))
        .map((c) => ({ hex: c.hex!.startsWith("#") ? c.hex!.toUpperCase() : `#${c.hex!.toUpperCase()}`, type: String(c.type ?? "other"), ...(typeof c.brightness === "number" ? { brightness: c.brightness } : {}) }))
      // Prefer the wordmark ("logo") over the square icon; SVG over PNG (crisp
      // at every card size). Only the Brandfetch CDN is ever rendered (SSRF guard).
      const pick = (theme: string) => {
        const logo = (data.logos ?? []).find((l) => l.type === "logo" && l.theme === theme) ?? (data.logos ?? []).find((l) => l.type === "logo")
        const formats = logo?.formats ?? []
        const src = (formats.find((f) => f.format === "svg") ?? formats.find((f) => f.format === "png") ?? formats[0])?.src ?? ""
        return src && isSafeLogoUrl(src) ? src : ""
      }
      if (colors.length || pick("dark") || pick("light")) {
        value = { colors, logo_dark_url: pick("dark"), logo_light_url: pick("light") }
      }
    }
  } catch {
    value = null
  }
  if (paletteCache.size >= PALETTE_CACHE_MAX) paletteCache.delete(paletteCache.keys().next().value as string)
  paletteCache.set(d, { at: Date.now(), value })
  return value
}

// Optional bank-detail fields shared by account create + update. Accepts the
// snake_case keys the client sends and maps them to Drizzle camelCase columns.
export type BankDetailInput = {
  brand_domain?: string
  logo_url?: string
  country?: string
  account_number?: string
  routing_number?: string
  swift?: string
  address?: string
  location?: string
  note?: string
}

export function pickBankDetails(body: BankDetailInput) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  return {
    brandDomain: str(body.brand_domain),
    logoUrl: str(body.logo_url),
    country: str(body.country).toUpperCase().slice(0, 2),
    accountNumber: str(body.account_number),
    routingNumber: str(body.routing_number),
    swift: str(body.swift).toUpperCase(),
    address: str(body.address),
    location: str(body.location),
    note: str(body.note),
  }
}

/**
 * Best-effort logo resolve+store columns. Never throws — a missing logo must not
 * block the account write. Returns the columns to persist or null.
 */
export async function resolveLogoColumns(brandDomain: string, logoUrl: string): Promise<{ logoUrl: string; logoData: string } | null> {
  if (!brandDomain && !logoUrl) return null
  try {
    const got = await fetchLogoData({ logoUrl: logoUrl || undefined, domain: brandDomain || undefined })
    if (got) return { logoUrl: got.logo_url, logoData: got.logo_data }
  } catch {
    /* ignore — keep whatever logo_url the client gave us */
  }
  return logoUrl ? { logoUrl, logoData: "" } : null
}

/**
 * Resolve a logo image to a base64 copy (stored on the account) + the URL that
 * worked (rendered by the UI). Tries the provided URL first, then derives one
 * from the domain via free favicon services. Returns null if nothing resolved.
 */
export async function fetchLogoData(opts: { logoUrl?: string; domain?: string }): Promise<{ logo_data: string; logo_url: string; file_type: string } | null> {
  const candidates: string[] = []
  if (opts.logoUrl) candidates.push(opts.logoUrl)
  if (opts.domain) {
    candidates.push(`https://cdn.brandfetch.io/${opts.domain}/w/256/h/256`)
    candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(opts.domain)}&sz=128`)
    candidates.push(`https://icons.duckduckgo.com/ip3/${opts.domain}.ico`)
  }
  for (const url of candidates) {
    if (!isSafeLogoUrl(url)) continue
    try {
      const res = await fetchWithTimeout(url, {}, 2500)
      if (!res.ok) continue
      const type = res.headers.get("content-type") ?? "image/png"
      if (!type.startsWith("image/")) continue
      // SVG is a script-capable document format — never persist it as logo
      // bytes that later round-trip into the DOM as a data: URL.
      if (type.includes("svg")) continue
      const buf = Buffer.from(await res.arrayBuffer())
      // Skip empty responses and anything implausibly large for a logo.
      if (buf.length < 64 || buf.length > 512 * 1024) continue
      const base64 = buf.toString("base64")
      // Trust the BYTES, not the header: only store recognizable raster images.
      const sniffed = sniffImageMime(base64)
      if (!sniffed || sniffed === "image/svg+xml") continue
      return { logo_data: base64, logo_url: url, file_type: sniffed }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}
