import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { BellRing } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  isPushConfigured,
  isPushSupported,
  isSubscribed,
  pushPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pwa/web-push"

// Per-device push opt-in. Reflects the BROWSER subscription state (not a stored
// preference) — toggling subscribes/unsubscribes this device. Hidden when push
// is unsupported or no VAPID public key is configured.
export function PushToggle() {
  const { t } = useTranslation("notifications")
  const { getToken } = useAuth()
  const [supported] = useState(() => isPushSupported() && isPushConfigured())
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!supported) return
    setBlocked(pushPermission() === "denied")
    void isSubscribed().then(setSubscribed)
  }, [supported])

  const onToggle = useCallback(
    async (on: boolean) => {
      setBusy(true)
      try {
        if (on) {
          const res = await subscribeToPush(getToken)
          if (res.ok) {
            setSubscribed(true)
            toast.success(t("push.enabled"))
          } else if (res.reason === "blocked") {
            setBlocked(true)
            toast.error(t("push.blocked"))
          } else if (res.reason === "unsupported" || res.reason === "unconfigured" || res.reason === "no_sw") {
            toast.error(t("push.unsupported"))
          }
        } else {
          await unsubscribeFromPush(getToken)
          setSubscribed(false)
          toast.success(t("push.disabled"))
        }
      } finally {
        setBusy(false)
      }
    },
    [getToken, t],
  )

  if (!supported) return null

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="flex items-start gap-2.5">
        <BellRing className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{t("push.enable")}</p>
          <p className="text-xs text-muted-foreground">{blocked ? t("push.blocked") : t("push.description")}</p>
        </div>
      </div>
      <Switch
        checked={subscribed}
        onCheckedChange={onToggle}
        disabled={busy || blocked}
        aria-label={t("push.enable")}
      />
    </div>
  )
}
