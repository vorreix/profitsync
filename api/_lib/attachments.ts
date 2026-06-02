import type { VercelResponse } from "@vercel/node"

// ---------------------------------------------------------------------------
// Attachment security.
//
// Attachments are user-supplied files stored as base64 in the DB and served
// back. To keep that safe we:
//   1. Allow only a fixed set of *file extensions*, each mapped to a known-safe
//      canonical MIME type. Security decisions are made on the extension (which
//      we control via this allowlist), never on the browser-supplied MIME type
//      (which is trivially spoofable). HTML/SVG/JS and executables are excluded.
//   2. Validate that file_data is real base64 and bound its decoded size.
//   3. Sanitize the filename (no path traversal, no control chars, length cap).
//   4. Serve downloads with Content-Disposition: attachment, X-Content-Type-
//      Options: nosniff, and a locked-down CSP, so a file can never execute or
//      render inline in the app's origin even if a stored type is wrong.
// ---------------------------------------------------------------------------

// Extension → canonical, safe Content-Type used for both validation and serving.
const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export const ALLOWED_EXTENSIONS = Object.keys(EXT_TYPES)

// Absolute hard cap on a single attachment's decoded size, independent of the
// plan quota. base64 in a JSON body also has to fit under Vercel's request body
// limit (~4.5 MB), so this is intentionally conservative.
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

const MAX_FILENAME_LENGTH = 200

// ASCII control characters (0x00-0x1F and 0x7F), stripped from filenames to
// prevent header injection / response splitting. Built via the RegExp
// constructor so the source file stays free of literal control bytes.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g")
// Anything outside printable ASCII (space .. tilde), for the header-safe
// ASCII filename fallback.
const NON_ASCII = new RegExp("[^\\u0020-\\u007e]", "g")

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot < 0 || dot === fileName.length - 1) return ""
  return fileName.slice(dot + 1).toLowerCase()
}

// Strip directory components and anything that could break a header or the
// filesystem, then cap the length. Always returns a non-empty name.
export function sanitizeFileName(raw: string): string {
  const base =
    String(raw ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() ?? ""
  const cleaned = base.replace(CONTROL_CHARS, "").trim().slice(0, MAX_FILENAME_LENGTH)
  return cleaned || "file"
}

// Safe Content-Type for serving, derived purely from the (sanitized) filename's
// extension. Falls back to octet-stream for anything not on the allowlist —
// including legacy rows whose stored type predates this validation.
export function safeContentType(fileName: string): string {
  return EXT_TYPES[extensionOf(sanitizeFileName(fileName))] ?? "application/octet-stream"
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

export type ValidatedUpload = {
  fileName: string
  fileType: string
  fileSize: number
  byteLength: number
}

export type UploadValidation =
  | { ok: true; value: ValidatedUpload }
  | { ok: false; error: string }

// Validate an attachment upload body. On success returns the sanitized filename
// and the canonical (extension-derived) MIME type to persist — the client's
// declared file_type is never trusted for storage or serving.
export function validateUpload(input: {
  file_name?: unknown
  file_type?: unknown
  file_size?: unknown
  file_data?: unknown
}): UploadValidation {
  if (typeof input.file_name !== "string" || typeof input.file_data !== "string") {
    return { ok: false, error: "file_name and file_data are required" }
  }

  const fileName = sanitizeFileName(input.file_name)
  const ext = extensionOf(fileName)
  const canonicalType = EXT_TYPES[ext]
  if (!canonicalType) {
    return {
      ok: false,
      error: `File type not allowed. Accepted types: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    }
  }

  const data = input.file_data
  if (!data || !BASE64_RE.test(data) || data.length % 4 !== 0) {
    return { ok: false, error: "file_data must be valid base64" }
  }

  const byteLength = Buffer.byteLength(data, "base64")
  if (byteLength === 0) return { ok: false, error: "Attachment is empty" }
  if (byteLength > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `Attachment exceeds the ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB limit.`,
    }
  }

  // Trust the decoded byte length over the client-declared size.
  const declared = typeof input.file_size === "number" && input.file_size > 0 ? input.file_size : 0
  const fileSize = Math.max(declared, byteLength)

  return { ok: true, value: { fileName, fileType: canonicalType, fileSize, byteLength } }
}

// RFC 5987 encoding for the Content-Disposition filename* parameter.
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

// Set headers that force a safe download of an attachment: never executed or
// rendered inline, never MIME-sniffed, type derived only from the allowlist.
export function setDownloadHeaders(res: VercelResponse, fileName: string, byteLength: number): void {
  const safeName = sanitizeFileName(fileName)
  // ASCII-only fallback for the legacy `filename=` param (header-injection safe).
  const asciiName = safeName.replace(NON_ASCII, "_").replace(/["\\]/g, "_")
  res.setHeader("Content-Type", safeContentType(safeName))
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${rfc5987(safeName)}`,
  )
  res.setHeader("Content-Length", byteLength)
}
