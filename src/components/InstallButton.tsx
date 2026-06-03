import { useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Download, Share, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt"

type Variant = "solid" | "outline"

const VARIANTS: Record<Variant, string> = {
  solid: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-border bg-background text-foreground hover:bg-muted",
}

interface InstallButtonProps {
  /** Visible label. Pass `null` for an icon-only button (provide `ariaLabel`). */
  label: ReactNode | null
  /** iOS "Add to Home Screen" sheet title (iOS Safari can't install programmatically). */
  iosTitle: string
  /** iOS sheet body text. */
  iosBody: string
  /** "Got it" / close label for the iOS sheet. */
  closeLabel: string
  variant?: Variant
  className?: string
  ariaLabel?: string
}

// A single install affordance reused in the app navbar AND the landing navbar.
// It is i18n-instance-agnostic (all text comes in as props) and themed with the
// shared CSS variables so it looks native in both surfaces. Renders nothing when
// the app is already installed or the browser can't install it.
export function InstallButton({
  label,
  iosTitle,
  iosBody,
  closeLabel,
  variant = "solid",
  className,
  ariaLabel,
}: InstallButtonProps) {
  const { canInstall, isInstalled, isIosSafari, promptInstall } = useInstallPrompt()
  const [iosOpen, setIosOpen] = useState(false)

  if (isInstalled) return null
  if (!canInstall && !isIosSafari) return null

  const onClick = () => {
    if (canInstall) void promptInstall()
    else setIosOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors active:scale-[0.97] motion-reduce:active:scale-100 cursor-pointer",
          label === null && "size-9 p-0",
          VARIANTS[variant],
          className,
        )}
      >
        <Download className="size-4" />
        {label}
      </button>

      {iosOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
            onClick={() => setIosOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border bg-background p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Share className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">{iosTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{iosBody}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIosOpen(false)}
                  aria-label={closeLabel}
                  className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIosOpen(false)}
                className="mt-4 w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                {closeLabel}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
