import { describe, expect, it } from "vitest"
import { logoDataUrl, sniffImageMime } from "./logo-data"

const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64")

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]
const ICO = [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]

describe("sniffImageMime", () => {
  it("detects png", () => expect(sniffImageMime(b64(PNG))).toBe("image/png"))
  it("detects jpeg", () => expect(sniffImageMime(b64(JPEG))).toBe("image/jpeg"))
  it("detects gif", () => expect(sniffImageMime(b64(GIF))).toBe("image/gif"))
  it("detects webp (RIFF…WEBP)", () => expect(sniffImageMime(b64(WEBP))).toBe("image/webp"))
  it("detects ico", () => expect(sniffImageMime(b64(ICO))).toBe("image/x-icon"))
  it("detects svg", () => expect(sniffImageMime(b64('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml"))
  it("detects svg with xml prolog + leading whitespace", () =>
    expect(sniffImageMime(b64('  <?xml version="1.0"?><svg/>'))).toBe("image/svg+xml"))
  it("rejects plain RIFF that is not WEBP (e.g. wav)", () =>
    expect(sniffImageMime(b64([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]))).toBeNull())
  it("rejects non-image text", () => expect(sniffImageMime(b64("hello world this is not an image"))).toBeNull())
  it("rejects html (hotlink error pages stored by mistake)", () =>
    expect(sniffImageMime(b64("<!doctype html><html><body>403</body></html>"))).toBeNull())
  it("rejects invalid base64", () => expect(sniffImageMime("not!!base64???")).toBeNull())
  it("rejects empty input", () => expect(sniffImageMime("")).toBeNull())
})

describe("logoDataUrl", () => {
  it("builds a data url with the sniffed mime", () => {
    const data = b64(PNG)
    expect(logoDataUrl(data)).toBe(`data:image/png;base64,${data}`)
  })
  it("returns null for empty / null / unrecognizable content", () => {
    expect(logoDataUrl("")).toBeNull()
    expect(logoDataUrl(null)).toBeNull()
    expect(logoDataUrl(undefined)).toBeNull()
    expect(logoDataUrl(b64("plain text"))).toBeNull()
  })
  it("tolerates whitespace in stored base64", () => {
    const data = b64(JPEG)
    const spaced = data.slice(0, 4) + "\n" + data.slice(4)
    expect(logoDataUrl(spaced)).toBe(`data:image/jpeg;base64,${spaced.trim()}`)
  })

  it("NEVER emits SVG data URLs (script-capable format), even though sniffing detects it", () => {
    const svg = b64('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    expect(sniffImageMime(svg)).toBe("image/svg+xml")
    expect(logoDataUrl(svg)).toBeNull()
  })

  it("refuses to inline oversized payloads (falls back to the remote URL)", () => {
    // A valid PNG header followed by >128KB of padding.
    const big = Buffer.concat([Buffer.from(Uint8Array.from(PNG)), Buffer.alloc(200 * 1024)]).toString("base64")
    expect(logoDataUrl(big)).toBeNull()
  })
})
