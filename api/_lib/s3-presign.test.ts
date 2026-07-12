import { describe, expect, it } from "vitest"
import { presignUrl } from "./s3-presign.js"
import { getS3Config, presignGetObject } from "./s3.js"

// The canonical AWS Signature Version 4 presigned-URL example, published in the
// AWS docs ("Example: GET Object" / SigV4 query-string test vector). If our
// hand-rolled signer reproduces this exact signature, the crypto is correct.
//   https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
const AWS_EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE", // secret-scan:ignore — AWS public doc example
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", // secret-scan:ignore — AWS public doc example
  region: "us-east-1",
  host: "examplebucket.s3.amazonaws.com",
  path: "/test.txt",
  now: new Date("2013-05-24T00:00:00.000Z"),
  expiresIn: 86400,
  expectedSignature: "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
}

describe("presignUrl (SigV4 query-string)", () => {
  it("reproduces the canonical AWS example signature", () => {
    const url = presignUrl({
      method: "GET",
      host: AWS_EXAMPLE.host,
      path: AWS_EXAMPLE.path,
      region: AWS_EXAMPLE.region,
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      expiresIn: AWS_EXAMPLE.expiresIn,
      now: AWS_EXAMPLE.now,
    })
    expect(url).toContain(`X-Amz-Signature=${AWS_EXAMPLE.expectedSignature}`)
  })

  it("emits all required SigV4 query params in the URL", () => {
    const url = presignUrl({
      host: AWS_EXAMPLE.host,
      path: AWS_EXAMPLE.path,
      region: AWS_EXAMPLE.region,
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      expiresIn: AWS_EXAMPLE.expiresIn,
      now: AWS_EXAMPLE.now,
    })
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256")
    expect(url).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request") // secret-scan:ignore — AWS public doc example
    expect(url).toContain("X-Amz-Date=20130524T000000Z")
    expect(url).toContain("X-Amz-Expires=86400")
    expect(url).toContain("X-Amz-SignedHeaders=host")
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true)
  })

  it("is deterministic for a fixed clock", () => {
    const args = {
      host: AWS_EXAMPLE.host,
      path: AWS_EXAMPLE.path,
      region: AWS_EXAMPLE.region,
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      now: AWS_EXAMPLE.now,
    }
    expect(presignUrl(args)).toBe(presignUrl(args))
  })

  it("percent-encodes object keys with reserved characters (space, unicode)", () => {
    const url = presignUrl({
      host: "b.example.com",
      path: "/folder/my file+é.pdf",
      region: "us-east-1",
      accessKeyId: "AKID",
      secretAccessKey: "secret", // secret-scan:ignore — test literal
      now: AWS_EXAMPLE.now,
    })
    // space -> %20, '+' -> %2B, 'é' -> %C3%A9; slashes preserved.
    expect(url).toContain("/folder/my%20file%2B%C3%A9.pdf?")
    expect(url).not.toContain(" ")
  })

  it("clamps expiry to the SigV4 max of 7 days", () => {
    const url = presignUrl({
      host: AWS_EXAMPLE.host,
      path: AWS_EXAMPLE.path,
      region: AWS_EXAMPLE.region,
      accessKeyId: AWS_EXAMPLE.accessKeyId,
      secretAccessKey: AWS_EXAMPLE.secretAccessKey,
      expiresIn: 999_999_999,
      now: AWS_EXAMPLE.now,
    })
    expect(url).toContain("X-Amz-Expires=604800")
  })
})

describe("presignGetObject (high-level, path-style)", () => {
  const cfg = {
    host: "fsn1.your-objectstorage.com",
    protocol: "https" as const,
    region: "eu-central",
    bucket: "profitsync",
    accessKeyId: "AKID",
    secretAccessKey: "secret", // secret-scan:ignore — test literal
    forcePathStyle: true,
  }

  it("builds a path-style URL (host/bucket/key) and signs response headers", () => {
    const url = presignGetObject(cfg, "quotations/org/quote/hash.pdf", {
      now: AWS_EXAMPLE.now,
      disposition: "attachment",
      filename: "Quotation Acme.pdf",
      expiresIn: 3600,
    })
    expect(url.startsWith("https://fsn1.your-objectstorage.com/profitsync/quotations/org/quote/hash.pdf?")).toBe(true)
    expect(url).toContain("response-content-type=application%2Fpdf")
    // "attachment; filename=\"Quotation Acme.pdf\"" fully percent-encoded in the query.
    expect(url).toContain("response-content-disposition=attachment%3B%20filename%3D%22Quotation%20Acme.pdf%22")
    expect(url).toContain("X-Amz-Signature=")
  })

  it("defaults to a 1-hour inline URL", () => {
    const url = presignGetObject(cfg, "quotations/a/b/c.pdf", { now: AWS_EXAMPLE.now })
    expect(url).toContain("X-Amz-Expires=3600")
    expect(url).not.toContain("response-content-disposition")
  })

  it("virtual-hosted style puts the bucket in the host", () => {
    const url = presignGetObject({ ...cfg, forcePathStyle: false }, "a/b.pdf", { now: AWS_EXAMPLE.now })
    expect(url.startsWith("https://profitsync.fsn1.your-objectstorage.com/a/b.pdf?")).toBe(true)
  })
})

describe("getS3Config", () => {
  it("returns null when env is not fully configured", () => {
    const saved = { ...process.env }
    delete process.env.S3_ENDPOINT
    delete process.env.S3_BUCKET
    delete process.env.S3_ACCESS_KEY
    delete process.env.S3_SECRET_KEY
    expect(getS3Config()).toBeNull()
    Object.assign(process.env, saved)
  })
})
