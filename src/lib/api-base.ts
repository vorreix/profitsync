export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "")

export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

function shouldRewriteUrl(url: URL): boolean {
  if (!API_BASE_URL || !url.pathname.startsWith("/api")) return false
  return url.protocol === "capacitor:" || url.protocol === "ionic:" || url.protocol === "file:" || url.origin === window.location.origin
}

export function installApiBaseFetchRewrite() {
  if (typeof window === "undefined" || !API_BASE_URL) return

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let finalInput = input

    if (typeof input === "string") {
      finalInput = input.startsWith("/api") ? apiUrl(input) : input
    } else if (input instanceof URL) {
      finalInput = shouldRewriteUrl(input) ? apiUrl(input.pathname + input.search + input.hash) : input
    } else {
      try {
        const url = new URL(input.url)
        if (shouldRewriteUrl(url)) {
          finalInput = new Request(apiUrl(url.pathname + url.search + url.hash), input)
        }
      } catch {
        // Leave unusual Request URLs untouched.
      }
    }

    return originalFetch(finalInput, init)
  }
}
