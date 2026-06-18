const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim()

let installed = false

function shouldRewrite(input: RequestInfo | URL): boolean {
  if (typeof input === "string") return input.startsWith("/api/")
  if (input instanceof URL) return input.origin === window.location.origin && input.pathname.startsWith("/api/")
  if (input instanceof Request) {
    const url = new URL(input.url)
    return url.origin === window.location.origin && url.pathname.startsWith("/api/")
  }
  return false
}

function rewriteUrl(input: string | URL): string {
  const base = new URL(API_BASE_URL!)
  const url = new URL(input.toString(), window.location.origin)
  url.protocol = base.protocol
  url.host = base.host
  return url.toString()
}

function rewriteRequest(input: Request): Request {
  return new Request(rewriteUrl(input.url), input)
}

export function installApiBaseFetchRewrite() {
  if (installed || !API_BASE_URL || typeof window === "undefined") return

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (!shouldRewrite(input)) return originalFetch(input, init)

    if (input instanceof Request) return originalFetch(rewriteRequest(input), init)
    return originalFetch(rewriteUrl(input), init)
  }
  installed = true
}
