import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Download, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt"

const DISMISS_KEY = "profitsync-pwa-install-dismissed"
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_MS
  } catch {
    return false
  }
}

// Dismissible install card. Renders only on installable browsers (or iOS Safari with
// instructions). Self-hides when already installed or recently dismissed. Mounted on
// login/signup/app screens only — never on the landing page.
export function InstallAppBanner({ className }: { className?: string }) {
  const { t } = useTranslation("pwa")
  const { canInstall, isInstalled, isIosSafari, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState<boolean>(recentlyDismissed)

  if (isInstalled || dismissed) return null
  const mode: "install" | "ios" | null = canInstall ? "install" : isIosSafari ? "ios" : null
  if (!mode) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* ignore storage failures */
    }
    setDismissed(true)
  }

  return (
    <div className={cn("relative flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm", className)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Download className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{mode === "ios" ? t("iosTitle") : t("installTitle")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{mode === "ios" ? t("iosBody") : t("installBody")}</p>
        {mode === "install" && (
          <Button size="sm" className="mt-2" onClick={() => void promptInstall()}>
            {t("installButton")}
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismiss")}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
