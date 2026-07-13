// Platform-correct View / Download for worker-generated PDFs on cross-origin
// presigned URLs (quotation PDFs).
//
// Why not window.open(url, "_blank", "noopener,noreferrer")? Three real-world
// failures: (1) with "noopener" in the features string window.open returns
// null BY SPEC even on success, so callers that null-check toast an error on
// every platform; (2) the Capacitor WebViews don't open popups — iOS shows
// nothing, Android bounces the user out of the app to the system browser;
// (3) installed PWAs popup-block cross-origin window.open unreliably. A
// cross-origin <a download> click is no better: the download attribute is
// ignored cross-origin on the web and the WebViews have no download handler.
//
// The fixes, per platform:
// - native → @capacitor/browser (Chrome Custom Tab / SFSafariViewController):
//   in-app presentation, renders PDFs, dismisses back to the app. Same pattern
//   as the native OAuth flow (use-native-oauth-intercept.ts). The plugin is
//   imported dynamically so it stays in the lazy "native" chunk.
// - web View → a synthetic <a target="_blank" rel="noopener"> click: popup-safe
//   inside a user gesture and has no null-return footgun.
// - web Download → authenticated fetch of the SAME-ORIGIN proxy route
//   (/api/quotations/:id/pdf/file) into a blob, saved via a blob-URL anchor —
//   identical to how the attachment modals download files everywhere.

import { nativePlatform } from "@/lib/native-auth"
import { nativePdfUrl, quotationPdfFilePath, type PdfUrls } from "@/lib/pdf-open-urls"

async function openInNativeBrowser(url: string): Promise<boolean> {
  try {
    const { Browser } = await import("@capacitor/browser")
    await Browser.open({ url, presentationStyle: "fullscreen" })
    return true
  } catch {
    return false
  }
}

function clickAnchor(configure: (a: HTMLAnchorElement) => void): void {
  const a = document.createElement("a")
  a.rel = "noopener noreferrer"
  configure(a)
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Open a PDF for viewing. Resolves false only on an observed failure (callers
 * toast then) — a successful hand-off to the browser/OS resolves true.
 */
export async function viewPdf(urls: PdfUrls): Promise<boolean> {
  const platform = nativePlatform()
  if (platform) return openInNativeBrowser(nativePdfUrl(platform, urls, "view"))
  // Runs synchronously inside the click's user gesture — see module comment.
  clickAnchor((a) => {
    a.href = urls.view_url
    a.target = "_blank"
  })
  return true
}

/** Download a PDF with a friendly filename. Resolves false on failure. */
export async function downloadPdf(opts: {
  quotationId: string
  generationId: string
  urls: PdfUrls
  filename: string
  /** Resolves the Authorization/x-org-id headers, or null when signed out. */
  getAuthHeaders: () => Promise<Record<string, string> | null>
}): Promise<boolean> {
  const platform = nativePlatform()
  if (platform) return openInNativeBrowser(nativePdfUrl(platform, opts.urls, "download"))
  try {
    const headers = await opts.getAuthHeaders()
    if (!headers) return false
    const res = await fetch(quotationPdfFilePath(opts.quotationId, opts.generationId, { download: true }), { headers })
    if (!res.ok) return false
    const blobUrl = URL.createObjectURL(await res.blob())
    clickAnchor((a) => {
      a.href = blobUrl
      a.download = opts.filename
    })
    // Give the browser ample time to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    return true
  } catch {
    return false
  }
}
