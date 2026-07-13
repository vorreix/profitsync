// Pure URL selection for opening generated quotation PDFs — import-free so the
// platform branching stays unit-testable (the DOM/plugin side lives in
// pdf-open.ts).

export type PdfUrls = { view_url: string; download_url: string }

/** Same-origin streaming proxy for a specific generation row (web download path). */
export function quotationPdfFilePath(
  quotationId: string,
  generationId: string,
  opts: { download?: boolean } = {},
): string {
  const dl = opts.download ? "&dl=1" : ""
  return `/api/quotations/${encodeURIComponent(quotationId)}/pdf/file?gen=${encodeURIComponent(generationId)}${dl}`
}

/**
 * Which presigned URL the native in-app browser should open. Android Custom
 * Tabs hand an `attachment` response to Chrome's download manager, so Download
 * uses the attachment URL there; SFSafariViewController has no download
 * manager, so iOS opens the inline URL and the user saves via the built-in
 * share sheet ("Save to Files").
 */
export function nativePdfUrl(platform: "android" | "ios", urls: PdfUrls, intent: "view" | "download"): string {
  if (intent === "view") return urls.view_url
  return platform === "ios" ? urls.view_url : urls.download_url
}
