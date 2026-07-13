import { describe, expect, it } from "vitest"
import { nativePdfUrl, quotationPdfFilePath } from "./pdf-open-urls"

const URLS = {
  view_url: "https://s3.example/bucket/key.pdf?sig=v&response-content-disposition=inline",
  download_url: "https://s3.example/bucket/key.pdf?sig=d&response-content-disposition=attachment",
}

describe("quotationPdfFilePath", () => {
  it("builds the inline proxy path", () => {
    expect(quotationPdfFilePath("q-1", "gen-1")).toBe("/api/quotations/q-1/pdf/file?gen=gen-1")
  })

  it("appends dl=1 for downloads", () => {
    expect(quotationPdfFilePath("q-1", "gen-1", { download: true })).toBe(
      "/api/quotations/q-1/pdf/file?gen=gen-1&dl=1",
    )
  })

  it("URL-encodes both ids", () => {
    expect(quotationPdfFilePath("a/b", "c&d=e")).toBe("/api/quotations/a%2Fb/pdf/file?gen=c%26d%3De")
  })
})

describe("nativePdfUrl", () => {
  it("always views the inline URL", () => {
    expect(nativePdfUrl("android", URLS, "view")).toBe(URLS.view_url)
    expect(nativePdfUrl("ios", URLS, "view")).toBe(URLS.view_url)
  })

  it("downloads via the attachment URL on Android (Custom Tab → download manager)", () => {
    expect(nativePdfUrl("android", URLS, "download")).toBe(URLS.download_url)
  })

  it("opens the inline URL on iOS (SFSafariViewController has no download manager)", () => {
    expect(nativePdfUrl("ios", URLS, "download")).toBe(URLS.view_url)
  })
})
