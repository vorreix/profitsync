import { useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  acceptUpdate,
  dismissUpdate,
  getUpdatePromptState,
  subscribeUpdatePrompt,
} from "@/lib/pwa/update-prompt-store"

// "A new version is ready" banner — the standard PWA update prompt. Shown when a
// freshly deployed service worker is installed and WAITING (it never activates on
// its own; see pwa/vite-pwa.ts). "Update" activates it and reloads onto the new
// version; "Later" hides the banner until the next release. Mounted once in
// App.tsx so it appears on every route, above the mobile tab bar.
export function UpdatePrompt() {
  const { t } = useTranslation("pwa")
  const state = useSyncExternalStore(subscribeUpdatePrompt, getUpdatePromptState, getUpdatePromptState)

  if (!state.updateAvailable) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-50 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur md:inset-x-auto md:end-6 md:bottom-6 md:w-80"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <RefreshCw className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">{t("updateTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("updateBody")}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={acceptUpdate} disabled={state.updating}>
              {state.updating && <Loader2 className="size-4 animate-spin" />}
              {state.updating ? t("updating") : t("updateNow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissUpdate} disabled={state.updating}>
              {t("updateLater")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
