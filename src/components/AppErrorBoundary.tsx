import { Component, type ErrorInfo, type ReactNode } from "react"

import { AppErrorFallback } from "@/components/AppErrorFallback"
import { clearChunkReloadGuard, reloadWithCacheBust } from "@/lib/pwa/chunk-recovery"

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
    // A stale chunk after a deploy: the shared bounded cache-bust reload recovers
    // it (cooperating with the other recovery paths via one sessionStorage budget).
    // If the budget is exhausted it no-ops and the fallback card (already rendered
    // via getDerivedStateFromError) stays up.
    if (isChunkLoadError(error) && reloadWithCacheBust()) return
    // Keep a console trail for Sentry/analytics-free debugging.
    console.error("[AppErrorBoundary]", error, info.componentStack)
  }

  handleReload = () => {
    // Manual "reload" button: reset the retry budget, then do a fresh cache-busted
    // load to bypass any stale HTTP cache.
    clearChunkReloadGuard()
    reloadWithCacheBust()
  }

  render() {
    if (this.state.hasError) return <AppErrorFallback onReload={this.handleReload} />
    return this.props.children
  }
}
