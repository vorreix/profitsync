import { Component, type ErrorInfo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"

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

function ErrorFallback({ onReload }: { onReload: () => void }) {
  // useTranslation is safe here: i18n is initialised in main.tsx before <App/>.
  const { t } = useTranslation()
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-lg font-semibold">{t("errorBoundary.title")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("errorBoundary.message")}</p>
      </div>
      <Button onClick={onReload} className="gap-2">
        <RotateCw className="size-4" />
        {t("errorBoundary.reload")}
      </Button>
    </div>
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
    if (this.state.hasError) return <ErrorFallback onReload={this.handleReload} />
    return this.props.children
  }
}
