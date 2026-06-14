import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { BellOff, Loader as Loader2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { apiGet, apiPut } from "@/lib/api"
import {
  fullDefaultPreferences,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type FullNotificationPreferences,
  type NotificationPreferences,
  type PreferenceScope,
} from "@/lib/notifications"
import { categoryIcon, categoryTone } from "./notification-ui"

type Props = {
  scope: PreferenceScope
  clientId?: string
  /** When false the controls are read-only (e.g. a non-admin viewing org policy). */
  canEdit?: boolean
}

// Merge a sparse stored preference object onto the full default grid so every
// category × channel has a concrete value to render.
function mergeStored(stored: NotificationPreferences): FullNotificationPreferences {
  const base = fullDefaultPreferences()
  if (typeof stored.muted === "boolean") base.muted = stored.muted
  for (const cat of NOTIFICATION_CATEGORIES) {
    const s = stored.categories?.[cat]
    if (!s) continue
    for (const ch of NOTIFICATION_CHANNELS) {
      if (typeof s[ch] === "boolean") base.categories[cat][ch] = s[ch] as boolean
    }
  }
  return base
}

// Reusable per-scope notification settings: a master mute plus per-category
// in-app / push toggles. Used by the profile (user), organization and client
// settings surfaces.
export function NotificationPreferencesForm({ scope, clientId, canEdit = true }: Props) {
  const { t } = useTranslation("notifications")
  const { getToken } = useAuth()
  const [prefs, setPrefs] = useState<FullNotificationPreferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const query = `/api/notifications/preferences?scope=${scope}${clientId ? `&clientId=${clientId}` : ""}`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ preferences: NotificationPreferences }>(query, token)
        if (!cancelled) setPrefs(mergeStored(res.preferences ?? {}))
      } catch {
        if (!cancelled) setPrefs(fullDefaultPreferences())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [getToken, query])

  const setMuted = (muted: boolean) => {
    setPrefs((p) => (p ? { ...p, muted } : p))
    setDirty(true)
  }
  const setChannel = (cat: (typeof NOTIFICATION_CATEGORIES)[number], ch: (typeof NOTIFICATION_CHANNELS)[number], on: boolean) => {
    setPrefs((p) => (p ? { ...p, categories: { ...p.categories, [cat]: { ...p.categories[cat], [ch]: on } } } : p))
    setDirty(true)
  }

  const save = useCallback(async () => {
    if (!prefs) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPut(query, token, { preferences: prefs })
      setDirty(false)
      toast.success(t("settings.saved"))
    } catch {
      toast.error(t("settings.saving"))
    } finally {
      setSaving(false)
    }
  }, [prefs, getToken, query, t])

  if (!prefs) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  const muted = prefs.muted
  const controlsDisabled = !canEdit

  return (
    <div className="space-y-5">
      {/* Master mute */}
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start gap-2.5">
          <BellOff className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("settings.mute_all")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.mute_all_hint")}</p>
          </div>
        </div>
        <Switch checked={!!muted} onCheckedChange={setMuted} disabled={controlsDisabled} aria-label={t("settings.mute_all")} />
      </div>

      {/* Per-category grid */}
      <div className={cn("grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-x-2 gap-y-1", muted && "opacity-50")}>
        <div />
        <span className="text-center text-[11px] font-medium text-muted-foreground">{t("settings.channel_in_app")}</span>
        <span className="text-center text-[11px] font-medium text-muted-foreground">{t("settings.channel_push")}</span>

        {NOTIFICATION_CATEGORIES.map((cat) => {
          const Icon = categoryIcon(cat)
          return (
            <div key={cat} className="contents">
              <div className="flex items-start gap-2.5 py-2">
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", categoryTone(cat))}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`categories.${cat}`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`settings.category_hint_${cat}`)}</p>
                </div>
              </div>
              {NOTIFICATION_CHANNELS.map((ch) => (
                <div key={ch} className="flex justify-center">
                  <Switch
                    size="sm"
                    checked={prefs.categories[cat][ch]}
                    onCheckedChange={(on) => setChannel(cat, ch, on)}
                    disabled={controlsDisabled || muted}
                    aria-label={`${t(`categories.${cat}`)} — ${t(`settings.channel_${ch === "in_app" ? "in_app" : "push"}`)}`}
                  />
                </div>
              ))}
            </div>
          )
        })}
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
