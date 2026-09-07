import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Gift, X } from "lucide-react"
import { useApiQuery } from "@/hooks/use-api-query"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "ps_ref_banner_dismissed"

type ReferralSettings = { settings?: { banner_enabled?: boolean; banner_text?: string } }

// App-wide, closeable referral banner whose copy + visibility are controlled by
// the platform admin (referral settings). Dismissal is remembered per banner
// text, so editing/re-enabling it shows again.
//
// It renders on every screen, which is exactly why it reads through
// `useApiQuery`: the settings are fetched once and then come from cache, so
// moving between pages doesn't re-ask. There is no loading state to write —
// the banner simply isn't there until there is something to say.
export function ReferralBanner({ className }: { className?: string }) {
  const navigate = useNavigate()
  const { data } = useApiQuery<ReferralSettings>("/api/referrals")
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) ?? ""
    } catch {
      return ""
    }
  })

  const settings = data?.settings
  const text = settings?.banner_enabled ? (settings.banner_text?.trim() ?? "") : ""
  if (!text || dismissed === text) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, text)
    } catch {
      /* private mode — it just comes back next load */
    }
    setDismissed(text)
  }

  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5", className)}>
      <Gift className="size-4 shrink-0 text-primary" />
      <button type="button" onClick={() => navigate("/referrals")} className="min-w-0 flex-1 text-left text-sm hover:underline">
        {text}
      </button>
      {/* The icon stays 16px; the BUTTON is a 36px target (the repo's floor for
          compact icon controls) so it can be tapped on a phone. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-me-1.5 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
