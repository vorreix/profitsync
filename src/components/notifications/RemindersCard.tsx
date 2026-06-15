import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { AlarmClock, Loader as Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import type { NotificationReminder, ReminderSchedule } from "@/lib/types"

type DayMode = "everyday" | "weekdays" | "custom"

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

// Localized short weekday names keyed 1=Mon … 7=Sun (Jan 1 2024 was a Monday).
function useWeekdayNames(): Record<number, string> {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: "short" })
    const out: Record<number, string> = {}
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i))
      out[i + 1] = fmt.format(d)
    }
    return out
  }, [i18n.language])
}

function dayModeOf(weekdays: number[]): DayMode {
  if (weekdays.length === 0 || weekdays.length === 7) return "everyday"
  if (weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => weekdays.includes(d))) return "weekdays"
  return "custom"
}

export function RemindersCard() {
  const { t } = useTranslation("notifications")
  const { getToken } = useAuth()
  const weekdayNames = useWeekdayNames()

  const [reminders, setReminders] = useState<NotificationReminder[] | null>(null)
  const [editing, setEditing] = useState<NotificationReminder | "new" | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ reminders: NotificationReminder[] }>("/api/notifications/reminders", token)
      setReminders(res.reminders ?? [])
    } catch {
      setReminders([])
    }
  }, [getToken])

  useEffect(() => {
    void load()
  }, [load])

  const summarize = useCallback(
    (s: ReminderSchedule): string => {
      const wd = s.weekdays ?? []
      const mode = dayModeOf(wd)
      const days =
        mode === "everyday"
          ? t("reminders.everyday")
          : mode === "weekdays"
            ? t("reminders.weekdays")
            : wd.slice().sort((a, b) => a - b).map((d) => weekdayNames[d]).join(", ")
      return `${days} · ${(s.times ?? []).join(", ")}`
    },
    [t, weekdayNames],
  )

  const toggleEnabled = async (r: NotificationReminder, enabled: boolean) => {
    setReminders((list) => list?.map((x) => (x.id === r.id ? { ...x, enabled } : x)) ?? list)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/notifications/reminders/${r.id}`, token, { enabled })
    } catch {
      // revert on failure
      setReminders((list) => list?.map((x) => (x.id === r.id ? { ...x, enabled: !enabled } : x)) ?? list)
      toast.error(t("reminders.error"))
    }
  }

  const confirmDelete = async () => {
    if (!deleteId) return
    const id = deleteId
    setDeleteId(null)
    setReminders((list) => list?.filter((x) => x.id !== id) ?? list)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/notifications/reminders/${id}`, token)
      toast.success(t("reminders.deleted"))
    } catch {
      toast.error(t("reminders.error"))
      void load()
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <AlarmClock className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("reminders.title")}</p>
            <p className="text-xs text-muted-foreground">{t("reminders.description")}</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          <span className="hidden sm:inline">{t("reminders.add")}</span>
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {reminders === null ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
        ) : reminders.length === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center">
            <p className="text-sm font-medium">{t("reminders.none")}</p>
            <p className="text-xs text-muted-foreground">{t("reminders.none_hint")}</p>
          </div>
        ) : (
          reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-md border bg-muted/20 p-2.5">
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => toggleEnabled(r, v)}
                aria-label={r.label}
              />
              <button
                type="button"
                onClick={() => setEditing(r)}
                className="min-w-0 flex-1 text-left"
              >
                <p className={cn("truncate text-sm font-medium", !r.enabled && "text-muted-foreground")}>{r.label}</p>
                <p className="truncate text-xs text-muted-foreground">{summarize(r.schedule)}</p>
              </button>
              <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setEditing(r)} aria-label={t("reminders.edit")}>
                <Pencil className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 shrink-0 text-destructive" onClick={() => setDeleteId(r.id)} aria-label={t("reminders.delete")}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      {editing && (
        <ReminderDialog
          reminder={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reminders.delete_confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("reminders.title")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("reminders.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t("reminders.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ReminderDialog({
  reminder,
  onClose,
  onSaved,
}: {
  reminder: NotificationReminder | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation("notifications")
  const { getToken } = useAuth()
  const weekdayNames = useWeekdayNames()

  // Open AFTER mount (false → true) so the shared Dialog's useBackClose sees a real
  // open transition — mounting already-open makes its StrictMode cleanup close it.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(true)
  }, [])

  const [label, setLabel] = useState(reminder?.label ?? "")
  const [enabled, setEnabled] = useState(reminder?.enabled ?? true)
  const [times, setTimes] = useState<string[]>(reminder?.schedule?.times?.length ? reminder.schedule.times : ["09:00"])
  const [mode, setMode] = useState<DayMode>(dayModeOf(reminder?.schedule?.weekdays ?? []))
  const [customDays, setCustomDays] = useState<number[]>(
    dayModeOf(reminder?.schedule?.weekdays ?? []) === "custom" ? (reminder?.schedule?.weekdays ?? []) : [1, 2, 3],
  )
  const tz = reminder?.schedule?.timezone || browserTz()
  const [saving, setSaving] = useState(false)

  const weekdays = mode === "everyday" ? [] : mode === "weekdays" ? [1, 2, 3, 4, 5] : customDays

  const setTime = (i: number, v: string) => setTimes((ts) => ts.map((t2, j) => (j === i ? v : t2)))
  const addTime = () => setTimes((ts) => [...ts, "12:00"])
  const removeTime = (i: number) => setTimes((ts) => (ts.length > 1 ? ts.filter((_, j) => j !== i) : ts))
  const toggleDay = (d: number) =>
    setCustomDays((days) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b)))

  const save = async () => {
    const cleanLabel = label.trim()
    const cleanTimes = Array.from(new Set(times.filter(Boolean)))
    if (!cleanLabel) return toast.error(t("reminders.name"))
    if (cleanTimes.length === 0) return toast.error(t("reminders.need_time"))
    if (mode === "custom" && customDays.length === 0) return toast.error(t("reminders.days"))
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const payload = { label: cleanLabel, enabled, schedule: { times: cleanTimes, weekdays, timezone: tz } }
      if (reminder) await apiPatch(`/api/notifications/reminders/${reminder.id}`, token, payload)
      else await apiPost("/api/notifications/reminders", token, payload)
      toast.success(t("reminders.saved"))
      onSaved()
    } catch (e) {
      toast.error((e as Error)?.message || t("reminders.error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{reminder ? t("reminders.edit_reminder") : t("reminders.new_reminder")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reminder-label">{t("reminders.name")}</Label>
            <Input
              id="reminder-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("reminders.name_placeholder")}
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("reminders.times")}</Label>
            <div className="space-y-2">
              {times.map((time, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="time" value={time} onChange={(e) => setTime(i, e.target.value)} className="w-36" />
                  {times.length > 1 && (
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => removeTime(i)} aria-label={t("reminders.delete")}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addTime}>
                <Plus className="size-4" />
                {t("reminders.add_time")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("reminders.days")}</Label>
            <div className="flex flex-wrap gap-2">
              {(["everyday", "weekdays", "custom"] as DayMode[]).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={mode === m ? "default" : "outline"}
                  onClick={() => setMode(m)}
                >
                  {t(`reminders.${m}`)}
                </Button>
              ))}
            </div>
            {mode === "custom" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    variant={customDays.includes(d) ? "default" : "outline"}
                    className="h-8 w-12 px-0"
                    onClick={() => toggleDay(d)}
                  >
                    {weekdayNames[d]}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/20 p-2.5">
            <Label htmlFor="reminder-enabled" className="cursor-pointer">{t("reminders.enabled")}</Label>
            <Switch id="reminder-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <p className="text-xs text-muted-foreground">{t("reminders.timezone")}: {tz} — {t("reminders.timezone_hint")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("reminders.cancel")}</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? t("reminders.saving") : t("reminders.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
