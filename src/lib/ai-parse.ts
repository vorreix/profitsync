import { apiGet, apiPost } from "@/lib/api"

// Client for the AI quick-add endpoints + receipt image preprocessing.
// Preprocessing is NOT optional polish: drawing to a canvas normalizes EXIF
// orientation (a rotated receipt collapses model accuracy from ~97% to ~28%),
// and the ≤1568px downscale caps both image tokens and upload size on mobile
// networks. See docs/ai-quick-add/RESEARCH.md §3/§6.

export type AiQuota = {
  enabled: boolean
  voice: boolean
  remaining: number
  limit: number
  max_record_seconds: number
  plan_key: string
}

export type AiParsedFields = {
  type: "incoming" | "outgoing"
  amount: number | null
  date: string | null
  category: string | null
  description: string | null
  client_id: string | null
  account_id: string | null
}

export type AiParseResponse = {
  fields: AiParsedFields
  confidence: { type: number; amount: number; date: number; category: number; client: number; account: number }
  client_candidates: { id: string; name: string }[] | null
  raw_client_name: string | null
  remaining: number
}

export const fetchAiQuota = (token: string) => apiGet<AiQuota>("/api/ai/quota", token)

export const parseWithAi = (
  token: string,
  input: {
    text?: string
    image?: { data: string; media_type: string }
    audio?: { data: string; media_type: string }
  },
) => apiPost<AiParseResponse>("/api/ai/parse-transaction", token, input)

const MAX_EDGE = 1568 // matches the model's standard-resolution long-edge cap
// Attachment budget: the parsed receipt is auto-attached to the transaction,
// and the FREE plan's per-file attachment limit is 1 MB — so compress until
// we're safely under it on every plan (also keeps the AI payload small).
const TARGET_BYTES = 900 * 1024

/**
 * Normalize orientation + downscale + re-encode a receipt photo.
 * Returns base64 (no data: prefix) ready for the parse endpoint, plus a
 * File of the processed image to attach to the transaction.
 */
export async function preprocessReceipt(file: File): Promise<{ data: string; media_type: "image/jpeg"; file: File }> {
  // createImageBitmap applies EXIF orientation ("from-image" is the default in
  // modern engines, incl. the Android/iOS WebViews we ship in).
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const draw = (cw: number, ch: number) => {
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("canvas unavailable")
      // White backdrop so transparent PNGs don't turn black in JPEG.
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, cw, ch)
      ctx.drawImage(bitmap, 0, 0, cw, ch)
    }
    // Compression ladder: step quality down, then resolution, until the file
    // fits the free plan's attachment limit. b64 length ≈ bytes × 4/3.
    const b64Target = Math.floor((TARGET_BYTES * 4) / 3)
    let dataUrl = ""
    draw(w, h)
    for (const quality of [0.8, 0.65, 0.5]) {
      dataUrl = canvas.toDataURL("image/jpeg", quality)
      if (dataUrl.length - 23 <= b64Target) break
    }
    if (dataUrl.length - 23 > b64Target) {
      const scale2 = 1280 / Math.max(w, h)
      draw(Math.max(1, Math.round(w * scale2)), Math.max(1, Math.round(h * scale2)))
      dataUrl = canvas.toDataURL("image/jpeg", 0.55)
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
    const bytes = atob(base64)
    const buf = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
    const processed = new File([buf], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
    return { data: base64, media_type: "image/jpeg", file: processed }
  } finally {
    bitmap.close()
  }
}
