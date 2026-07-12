// Dependency-free AWS Signature Version 4 **query-string** presigner for GET.
//
// Why hand-rolled instead of @aws-sdk/s3-request-presigner:
//   - keeps the prod `npm audit` surface clean (no AWS SDK tree);
//   - keeps the unit gate DB/network-free — this module is pure `node:crypto`
//     (same approach as api/_lib/push-fcm.ts's JWT signer);
//   - it's ~80 lines and fully covered by the canonical AWS SigV4 test vector.
//
// The output URL embeds a *signature*, never the secret key. It grants time-boxed
// read access to a single object and expires after `expiresIn` seconds — after
// which the link is dead and a fresh one must be minted by an authenticated route.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import { createHash, createHmac } from "node:crypto"

const ALGORITHM = "AWS4-HMAC-SHA256"
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"

export interface PresignInput {
  method?: string // default GET
  protocol?: "https" | "http" // default https
  host: string // e.g. "examplebucket.s3.amazonaws.com" or "fsn1.your-objectstorage.com"
  /** Canonical URI path, already segment-structured (e.g. "/bucket/key.pdf"). */
  path: string
  region: string
  service?: string // default "s3"
  accessKeyId: string
  secretAccessKey: string
  expiresIn?: number // seconds, default 3600 (1h), max 604800 (7d) per SigV4
  /** Extra query params to fold into the signature (e.g. response-content-disposition). */
  query?: Record<string, string>
  /** Injectable clock — supply in tests for determinism. Defaults to now. */
  now?: Date
}

/** RFC-3986 percent-encoding. AWS treats only A-Za-z0-9-_.~ as unreserved. */
function uriEncode(input: string, encodeSlash = true): string {
  let out = ""
  for (const byte of Buffer.from(input, "utf8")) {
    const ch = String.fromCharCode(byte)
    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || ch === "-" || ch === "_" || ch === "." || ch === "~") {
      out += ch
    } else if (ch === "/" && !encodeSlash) {
      out += "/"
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0")
    }
  }
  return out
}

function encodePath(path: string): string {
  // Encode each segment; keep the separating slashes.
  return path
    .split("/")
    .map((seg) => uriEncode(seg, true))
    .join("/")
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort() // byte-order sort by (already-encoded-safe) key
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&")
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest()
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex")
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac("AWS4" + secret, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, "aws4_request")
}

/**
 * Produce a SigV4 presigned URL. Deterministic for a fixed `now`, so the unit
 * test can assert it against AWS's published example signature.
 */
export function presignUrl(input: PresignInput): string {
  const method = input.method ?? "GET"
  const protocol = input.protocol ?? "https"
  const service = input.service ?? "s3"
  const expiresIn = Math.min(Math.max(input.expiresIn ?? 3600, 1), 604800)
  const now = input.now ?? new Date()

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "") // 20130524T000000Z
  const dateStamp = amzDate.slice(0, 8) // 20130524
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`

  const signedQuery: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
    ...(input.query ?? {}),
  }

  const canonicalUri = encodePath(input.path)
  const canonicalQueryString = canonicalQuery(signedQuery)
  const canonicalHeaders = `host:${input.host}\n`
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n")

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n")
  const signature = hmac(signingKey(input.secretAccessKey, dateStamp, input.region, service), stringToSign).toString("hex")

  return `${protocol}://${input.host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
}
