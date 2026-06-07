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
  if (!API_BASE_URL || typeof window === "undefined") return

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return originalFetch(input.startsWith("/api") ? apiUrl(input) : input, init)
    }

    if (input instanceof URL) {
      return originalFetch(shouldRewriteUrl(input) ? apiUrl(input.pathname + input.search + input.hash) : input, init)
    }

    try {
      const url = new URL(input.url)
      if (shouldRewriteUrl(url)) {
        return originalFetch(new Request(apiUrl(url.pathname + url.search + url.hash), input), init)
      }
    } catch {
      // Leave unusual Request URLs untouched.
    }

    return originalFetch(input, init)
  }
}
