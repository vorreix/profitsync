import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Gift, X } from "lucide-react"
import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "ps_ref_banner_dismissed"

// App-wide, closeable referral banner whose copy + visibility are controlled by
// the platform admin (referral settings). Dismissal is remembered per banner
// text, so editing/re-enabling it shows again.
export function ReferralBanner({ className }: { className?: string }) {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const data = await apiGet<{ settings?: { banner_enabled?: boolean; banner_text?: string } }>("/api/referrals", token)
        const s = data?.settings
        if (cancelled || !s?.banner_enabled || !s.banner_text?.trim()) return
        let dismissed = ""
        try { dismissed = localStorage.getItem(DISMISS_KEY) ?? "" } catch { /* ignore */ }
        if (dismissed !== s.banner_text) setText(s.banner_text)
      } catch {
        /* ignore */
      }
    })()
    return () => { cancelled = true }
  }, [getToken])

  if (!text) return null

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, text ?? "") } catch { /* ignore */ }
    setText(null)
  }

  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5", className)}>
      <Gift className="size-4 shrink-0 text-primary" />
      <button type="button" onClick={() => navigate("/referrals")} className="min-w-0 flex-1 text-left text-sm hover:underline">
        {text}
      </button>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  )
}
