// App-side S3 configuration + presigned-GET helper for generated artifacts
// (quotation PDFs). The app holds **read** credentials and mints short-lived
// presigned URLs on demand; the Go worker holds the **write** credentials and
// uploads the bytes. Same env-var names on both sides (see worker config.go), so a
// single Hetzner key can serve both, or you can split read/write keys.
//
// The bucket is PRIVATE — there is no public base URL for quotation PDFs. The only
// path to the bytes is a presigned URL produced here by an authenticated,
// org-scoped route. S3_* are server-only secrets and must never reach the browser.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import { presignUrl } from "./s3-presign.js"

export interface S3Config {
  host: string // endpoint host only (no scheme), e.g. "fsn1.your-objectstorage.com"
  protocol: "https" | "http"
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Path-style (host/bucket/key) vs virtual-hosted (bucket.host/key). Hetzner + */
  /** minio custom endpoints default to path-style, so that's our default. */
  forcePathStyle: boolean
}

/** Resolve S3 config from the environment, or null when not fully configured. */
export function getS3Config(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY
  const secretAccessKey = process.env.S3_SECRET_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null

  const useSSL = (process.env.S3_USE_SSL ?? "true").toLowerCase() !== "false"
  const host = endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  // Default to path-style unless explicitly disabled.
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false"
  return {
    host,
    protocol: useSSL ? "https" : "http",
    region: process.env.S3_REGION || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  }
}

export function isS3Configured(): boolean {
  return getS3Config() !== null
}

/** Where an object key lives: the request host + canonical path for signing. */
function objectLocation(cfg: S3Config, key: string): { host: string; path: string } {
  const cleanKey = key.replace(/^\/+/, "")
  if (cfg.forcePathStyle) {
    return { host: cfg.host, path: `/${cfg.bucket}/${cleanKey}` }
  }
  return { host: `${cfg.bucket}.${cfg.host}`, path: `/${cleanKey}` }
}

export interface PresignGetOptions {
  expiresIn?: number // seconds (default 3600 = 1h)
  /** "attachment" forces a download; "inline" (default) renders in the browser. */
  disposition?: "inline" | "attachment"
  /** Filename for the Content-Disposition header (download/inline). */
  filename?: string
  contentType?: string // default application/pdf
  now?: Date // injectable for tests
}

/**
 * Mint a short-lived presigned GET URL for an object. Response headers
 * (Content-Type / Content-Disposition) are set via SigV4-signed
 * `response-*` query params so a plain browser navigation renders inline or
 * downloads with a friendly filename — no bucket CORS config required.
 */
export function presignGetObject(cfg: S3Config, key: string, opts: PresignGetOptions = {}): string {
  const { host, path } = objectLocation(cfg, key)
  const contentType = opts.contentType ?? "application/pdf"
  const query: Record<string, string> = { "response-content-type": contentType }
  if (opts.disposition) {
    const name = sanitizeFilename(opts.filename)
    query["response-content-disposition"] = name ? `${opts.disposition}; filename="${name}"` : opts.disposition
  }
  return presignUrl({
    method: "GET",
    protocol: cfg.protocol,
    host,
    path,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresIn: opts.expiresIn ?? 3600,
    query,
    now: opts.now,
  })
}

/**
 * Best-effort delete of a stored object, used when pruning PDF history past the
 * newest 5. Presigns a short-lived DELETE and fires it server-side; a network
 * failure or a 4xx (e.g. already gone) resolves to false and is treated as
 * non-fatal — the DB row is removed regardless, so at worst an object is briefly
 * orphaned in the bucket. Server-only (holds the S3 secret).
 */
export async function deleteObject(cfg: S3Config, key: string): Promise<boolean> {
  const { host, path } = objectLocation(cfg, key)
  const url = presignUrl({
    method: "DELETE",
    protocol: cfg.protocol,
    host,
    path,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresIn: 300,
  })
  try {
    const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(5000) })
    return res.ok || res.status === 404 // 404 = already deleted = success for our purposes
  } catch {
    return false
  }
}

/** Strip characters that would break a quoted Content-Disposition filename. */
function sanitizeFilename(name?: string): string {
  if (!name) return ""
  return name.replace(/[\r\n"\\/]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
}
