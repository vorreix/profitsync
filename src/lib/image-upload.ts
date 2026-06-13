// Client-side image preparation for logo/avatar uploads: downscale to a small
// square-ish thumbnail on a canvas BEFORE uploading, so the stored base64 (and
// every list response that inlines it as a data URL) stays tiny — typically
// 5–30 KB of WebP instead of a multi-MB camera photo. The server re-validates
// (size cap + magic-byte mime sniff) regardless.

const MAX_DIM = 256
const MAX_INPUT_BYTES = 12 * 1024 * 1024 // refuse absurd inputs before decoding

/**
 * Returns a full `data:` URL (renderable directly as a preview). The API accepts
 * it verbatim — server-side validation strips the prefix and re-sniffs the mime.
 */
export async function fileToResizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image")
  if (file.size > MAX_INPUT_BYTES) throw new Error("too-large")

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error("decode-failed")

  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("decode-failed")
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  // Prefer WebP (smallest); browsers without WebP encoding silently return PNG
  // from toDataURL("image/webp"), which the server accepts too.
  const dataUrl = canvas.toDataURL("image/webp", 0.85)
  if (!dataUrl.includes(",") || dataUrl.length < 32) throw new Error("encode-failed")
  return dataUrl
}
