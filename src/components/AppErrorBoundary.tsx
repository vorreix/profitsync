import { Component, type ErrorInfo, type ReactNode } from "react"

import { AppErrorFallback } from "@/components/AppErrorFallback"

// Shared with index.html's inline recovery script + src/lib/pwa/register-sw.ts so
// the three recovery paths reload at most once between them.
const CHUNK_RELOAD_KEY = "profitsync-chunk-reload"

// A failed dynamic import / stale chunk after a deploy throws one of these.
function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "")
  return /loading (?:css )?chunk|dynamically imported module|importing a module script failed|failed to fetch dynamically/i.test(
    msg,
  )
}

type Props = { children: ReactNode }
type State = { hasError: boolean }

/**
 * Root error boundary. Turns the post-deploy "white screen" into recovery:
 * a stale lazy-route chunk that 404s after a new deploy throws a ChunkLoadError,
 * which we catch here. The FIRST such error auto-reloads once (guarded) so the
 * fresh shell + current chunks load; a subsequent failure shows a friendly
 * "reload to update" card instead of a blank page. Non-chunk render errors also
 * land on the card rather than crashing to white.
 *
 * (The very first *entry* chunk failing happens before React mounts, so it can't
 * reach this boundary — that case is handled by the inline script in index.html.)
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      let alreadyReloaded = false
      try {
        alreadyReloaded = !!sessionStorage.getItem(CHUNK_RELOAD_KEY)
        if (!alreadyReloaded) sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
      } catch {
        /* private mode — fall through to the manual card */
      }
      if (!alreadyReloaded) {
        window.location.reload()
        return
      }
    }
    // Keep a console trail for Sentry/analytics-free debugging.
    console.error("[AppErrorBoundary]", error, info.componentStack)
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) return <AppErrorFallback onReload={this.handleReload} />
    return this.props.children
  }
}
