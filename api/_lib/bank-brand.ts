// Bank brand lookup + logo fetching. Best-effort and FREE-tier friendly:
// autocomplete uses the Brandfetch Brand Search API (the project's existing key),
// and logo fetching degrades through Brandfetch's CDN → Google's favicon service
// → DuckDuckGo's icon service (the last two need no key and are unlimited). Every
// path fails soft: a missing logo never blocks creating/updating an account.

const BRANDFETCH_KEY = process.env.BRANDFETCH_APIKEY ?? ""

export type BrandResult = { name: string; domain: string; icon: string }

function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer))
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
    try {
      const res = await fetchWithTimeout(url, {}, 4500)
      if (!res.ok) continue
      const type = res.headers.get("content-type") ?? "image/png"
      if (!type.startsWith("image/")) continue
      const buf = Buffer.from(await res.arrayBuffer())
      // Skip empty responses and anything implausibly large for a logo.
      if (buf.length < 64 || buf.length > 512 * 1024) continue
      return { logo_data: buf.toString("base64"), logo_url: url, file_type: type }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}
