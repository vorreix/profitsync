// Server-side validation for small profile/logo image uploads (org logo, user
// avatar). The client resizes to ≤256px before uploading; this re-validates so
// nothing larger or non-image ever lands in the DB. The mime is DERIVED from the
// magic bytes (sniffImageMime) — the client's claimed type is never trusted.

import { sniffImageMime } from "../../src/lib/logo-data.js"

const MAX_IMAGE_BYTES = 300 * 1024
const ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/

export type ImageUploadResult =
  | { ok: true; data: string; mime: string }
  | { ok: false; error: string }

export function validateImageUpload(raw: unknown): ImageUploadResult {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Image data is required" }
  // Accept either a bare base64 payload or a full data: URL.
  const clean = raw.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")
  if (!clean || !BASE64_RE.test(clean)) return { ok: false, error: "Invalid image data" }
  const approxBytes = Math.floor((clean.length * 3) / 4)
  if (approxBytes > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 300 KB)" }
  const mime = sniffImageMime(clean)
  if (!mime || !ALLOWED_MIMES.has(mime)) return { ok: false, error: "Unsupported image format (use PNG, JPG, WebP or GIF)" }
  return { ok: true, data: clean, mime }
}

/** Build the data: URL the UI renders, or null when nothing is stored. */
export function imageSrc(data: string | null | undefined, mime: string | null | undefined): string | null {
  return data && mime ? `data:${mime};base64,${data}` : null
}
