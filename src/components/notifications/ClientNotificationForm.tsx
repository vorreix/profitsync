import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { BellOff, ArrowLeftRight, FileText, Loader as Loader2 } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { apiGet, apiPut } from "@/lib/api"
import type { NotificationCategory, NotificationPreferences } from "@/lib/notifications"

// A client doesn't need the full category×channel grid — just a master mute plus
// a few client-relevant triggers. Each trigger maps to one notification CATEGORY
// (both channels), so the shared cascade resolver is unchanged: trigger off →
// categories.<cat> = { in_app:false, web_push:false }.
type TriggerKey = "budget" | "transactions" | "clients"
const TRIGGERS: { key: TriggerKey; cat: NotificationCategory; icon: typeof MoneyBag }[] = [
  { key: "budget", cat: "budget", icon: MoneyBag },
  { key: "transactions", cat: "transactions", icon: ArrowLeftRight },
  { key: "clients", cat: "clients", icon: FileText },
]

type Props = { clientId: string; canEdit?: boolean }

export function ClientNotificationForm({ clientId, canEdit = true }: Props) {
  const { t } = useTranslation("notifications")
  const { getToken } = useAuth()
  const [muted, setMuted] = useState(false)
  const [on, setOn] = useState<Record<TriggerKey, boolean>>({ budget: true, transactions: true, clients: true })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const query = `/api/notifications/preferences?scope=client&clientId=${clientId}`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ preferences: NotificationPreferences }>(query, token)
        if (cancelled) return
        const p = res.preferences ?? {}
        setMuted(!!p.muted)
        // A trigger is ON unless explicitly turned off in the stored prefs.
        setOn({
          budget: p.categories?.budget?.in_app !== false,
          transactions: p.categories?.transactions?.in_app !== false,
          clients: p.categories?.clients?.in_app !== false,
        })
      } catch {
        /* defaults */
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [getToken, query])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const categories: NonNullable<NotificationPreferences["categories"]> = {}
      for (const { key, cat } of TRIGGERS) {
        // The simplified per-client toggle drives every channel together.
        categories[cat] = { in_app: on[key], web_push: on[key], mobile_push: on[key] }
      }
      await apiPut(query, token, { preferences: { muted, categories } })
      setDirty(false)
      toast.success(t("settings.saved"))
    } catch {
      toast.error(t("settings.saving"))
    } finally {
      setSaving(false)
    }
  }, [getToken, query, muted, on, t])

  if (!loaded) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start gap-2.5">
          <BellOff className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("client.mute")}</p>
            <p className="text-xs text-muted-foreground">{t("client.mute_hint")}</p>
          </div>
        </div>
        <Switch
          checked={muted}
          onCheckedChange={(v) => { setMuted(v); setDirty(true) }}
          disabled={!canEdit}
          aria-label={t("client.mute")}
        />
      </div>

      <div className={cn("space-y-1", muted && "opacity-50")}>
        <p className="text-xs font-medium text-muted-foreground">{t("client.notify_about")}</p>
        {TRIGGERS.map(({ key, icon: Icon }) => (
          <div key={key} className="flex items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-3.5" />
              </span>
              <div>
                <p className="text-sm font-medium">{t(`client.triggers.${key}`)}</p>
                <p className="text-xs text-muted-foreground">{t(`client.trigger_hints.${key}`)}</p>
              </div>
            </div>
            <Switch
              checked={on[key]}
              onCheckedChange={(v) => { setOn((prev) => ({ ...prev, [key]: v })); setDirty(true) }}
              disabled={!canEdit || muted}
              aria-label={t(`client.triggers.${key}`)}
            />
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? t("settings.saving") : t("settings.save")}
          </Button>
        </div>
      )}
    </div>
  )
}
