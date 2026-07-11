import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { BellRing, Send } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  ensureSubscriptionSynced,
  isPushConfigured,
  isPushSupported,
  isSubscribed,
  pushPermission,
  sendTestPush,
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
  const [testing, setTesting] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [testStatus, setTestStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (!supported) return
    setBlocked(pushPermission() === "denied")
    void isSubscribed().then((sub) => {
      setSubscribed(sub)
      // Self-heal: if the browser is subscribed, make sure the server still has
      // the row (a lost row is the most common reason pushes silently never arrive).
      if (sub) void ensureSubscriptionSynced(getToken)
    })
  }, [supported, getToken])

  const onToggle = useCallback(
    async (on: boolean) => {
      setBusy(true)
      setTestStatus(null)
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

  const onTest = useCallback(async () => {
    setTesting(true)
    setTestStatus(null)
    try {
      const res = await sendTestPush(getToken)
      if (!res) {
        setTestStatus({ kind: "error", text: t("push.test_error") })
      } else if (!res.configured) {
        setTestStatus({ kind: "error", text: t("push.test_not_configured") })
      } else if (res.subscriptions === 0) {
        setTestStatus({ kind: "error", text: t("push.test_no_subs") })
      } else if (res.ok > 0) {
        setTestStatus({ kind: "ok", text: t("push.test_sent", { count: res.ok }) })
      } else {
        // Delivered to nothing despite having subscriptions — stale endpoint or a
        // VAPID key mismatch (push service returns 403/410). Re-subscribing fixes it.
        const code = res.errors[0]
        setTestStatus({ kind: "error", text: t("push.test_failed", { code: code ? ` (${code})` : "" }) })
      }
    } finally {
      setTesting(false)
    }
  }, [getToken, t])

  if (!supported) return null

  return (
    <div className="space-y-2">
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

      {subscribed && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing}>
            <Send className={`size-3.5 ${testing ? "animate-pulse" : ""}`} />
            {t("push.test")}
          </Button>
          {testStatus && (
            <span
              className={`text-xs ${testStatus.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
            >
              {testStatus.text}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
