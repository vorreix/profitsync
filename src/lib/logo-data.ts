// Stored-logo helpers: sniff an image mime from base64 magic bytes and build a
// data: URL for the bank/brand logo bytes persisted on a wealth account
// (wealth_accounts.logo_data). Hotlinked third-party logo URLs expire, so the UI
// renders this data URL first and only falls back to the remote URL.
//
// Pure (no I/O, no Buffer/atob) so it is importable from both the API routes and
// the client bundle, and unit-testable.

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const B64_LOOKUP: Record<string, number> = {}
for (let i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET[i]] = i

/** Decode just the first `maxBytes` of a base64 string (enough for magic bytes). */
function decodeBase64Prefix(base64: string, maxBytes: number): Uint8Array | null {
  const clean = base64.replace(/\s+/g, "")
  if (!clean) return null
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < clean.length && out.length < maxBytes; i++) {
    const ch = clean[i]
    if (ch === "=") break
    const val = B64_LOOKUP[ch]
    if (val === undefined) return null // not base64 — refuse to build a data URL
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

/**
 * Detect the image mime type from base64-encoded bytes. Returns null when the
 * content is not a recognizable image (so callers never emit a data URL for
 * arbitrary content).
 */
export function sniffImageMime(base64: string): string | null {
  const b = decodeBase64Prefix(base64, 96)
  if (!b || b.length < 4) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  ) {
    return "image/webp"
  }
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return "image/x-icon"
  // ISO-BMFF "ftyp" box (avif/heic favicons served by some CDNs)
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif"
  // SVG is text — look for the opening tag in the first decoded bytes.
  let text = ""
  for (const byte of b) text += String.fromCharCode(byte)
  const trimmed = text.trimStart().toLowerCase()
  if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) return "image/svg+xml"
  return null
}

/**
 * Mimes safe to emit as `data:` URLs into `<img src>`. SVG is deliberately
 * EXCLUDED: it's a script-capable document format, and even though modern
 * browsers sandbox SVG-in-img, defense-in-depth says never round-trip
 * third-party SVG bytes back to the DOM.
 */
const RENDERABLE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/avif"])

/** Inline cap: ~128KB of raw bytes (≈171K base64 chars). Bigger stored logos
 * fall back to the remote URL instead of bloating every list response. */
const MAX_INLINE_BASE64_CHARS = 171_000

/**
 * Build a `data:<mime>;base64,…` URL from stored logo bytes, or null when there
 * is nothing stored / the bytes aren't a renderable raster image / the payload
 * is too heavy to inline into list responses.
 */
export function logoDataUrl(logoData: string | null | undefined): string | null {
  const data = (logoData ?? "").trim()
  if (!data || data.length > MAX_INLINE_BASE64_CHARS) return null
  const mime = sniffImageMime(data)
  if (!mime || !RENDERABLE_MIMES.has(mime)) return null
  return `data:${mime};base64,${data}`
}
