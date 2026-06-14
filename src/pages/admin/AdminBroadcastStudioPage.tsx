import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { NativeSelect } from "@/components/ui/native-select"
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
import { toast } from "sonner"
import { AlertTriangle, Loader as Loader2, Megaphone, Pencil, Play, Plus, Send, Trash2, X } from "lucide-react"
import type {
  Broadcast,
  BroadcastAudience,
  BroadcastRecurrence,
  BroadcastSchedule,
} from "@/lib/types"

type Group = { id: string; name: string; member_count: number }
type UserRow = { id: string; email: string; fullName: string | null }

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  sending: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  sent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  cancelled: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
}
const FILTERS = ["", "draft", "scheduled", "sent", "cancelled"]

function audienceSummary(a: BroadcastAudience): string {
  switch (a.type) {
    case "all": return "Everyone"
    case "push_enabled": return "Push-enabled users"
    case "users": return `${a.userIds.length} selected user${a.userIds.length === 1 ? "" : "s"}`
    case "group": return "A saved group"
    default: return "—"
  }
}
function scheduleSummary(b: Broadcast): string {
  const s = b.schedule
  if (b.status === "sent") return b.sent_at ? `Sent ${new Date(b.sent_at).toLocaleString()}` : "Sent"
  if (s.type === "now") return "Immediate"
  if (s.type === "at") return `At ${new Date(s.at).toLocaleString()}`
  if (s.type === "recurring") return `Every ${s.recurring.interval} ${s.recurring.freq.replace("ly", "")}(s) from ${new Date(s.at).toLocaleString()}`
  return "—"
}

// ISO <-> <input type="datetime-local"> value.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function AdminBroadcastStudioPage() {
  const { getToken } = useAuth()
  const [list, setList] = useState<Broadcast[] | null>(null)
  const [filter, setFilter] = useState("")
  const [editing, setEditing] = useState<Broadcast | "new" | null>(null)
  const [confirm, setConfirm] = useState<{ b: Broadcast; action: "send" | "delete" | "cancel" } | null>(null)
  const [busy, setBusy] = useState(false)
  const [runningDue, setRunningDue] = useState(false)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ broadcasts: Broadcast[] }>(`/api/admin/broadcasts${filter ? `?status=${filter}` : ""}`, token)
      setList(res.broadcasts ?? [])
    } catch {
      setList([])
    }
  }, [getToken, filter])

  useEffect(() => {
    void load()
  }, [load])

  const runDue = async () => {
    setRunningDue(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiPost<{ processed: { reminders: number; broadcasts: number } }>("/api/admin/broadcasts/run-due", token, {})
      toast.success(`Delivered ${res.processed.broadcasts} broadcast(s), ${res.processed.reminders} reminder(s)`)
      void load()
    } catch {
      toast.error("Couldn't run the scheduler")
    } finally {
      setRunningDue(false)
    }
  }

  const doConfirm = async () => {
    if (!confirm) return
    const { b, action } = confirm
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) return
      if (action === "send") {
        await apiPost(`/api/admin/broadcasts/${b.id}/send`, token, {})
        toast.success("Broadcast sent")
      } else if (action === "delete") {
        await apiDelete(`/api/admin/broadcasts/${b.id}`, token)
        toast.success("Broadcast deleted")
      } else {
        await apiPatch(`/api/admin/broadcasts/${b.id}`, token, { action: "cancel" })
        toast.success("Broadcast cancelled")
      }
      setConfirm(null)
      void load()
    } catch (e) {
      toast.error((e as Error)?.message || "Action failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-semibold tracking-tight">
            <Megaphone className="size-5 text-muted-foreground" /> Broadcasts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Send push notifications to users — now, scheduled, or recurring.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runDue} disabled={runningDue}>
            {runningDue ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run due now
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New broadcast
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((s) => (
          <button
            key={s || "all"}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${filter === s ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {list === null ? (
        <Skeleton className="h-40 w-full" />
      ) : list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No broadcasts{filter ? ` with status “${filter}”` : ""}.</Card>
      ) : (
        <div className="space-y-2">
          {list.map((b) => (
            <Card key={b.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{b.title}</p>
                  <Badge variant="secondary" className={STATUS_STYLE[b.status] ?? ""}>{b.status}</Badge>
                  {b.importance && <Badge variant="secondary" className="bg-rose-500/10 text-rose-600 dark:text-rose-300">Important</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {audienceSummary(b.audience)} · {scheduleSummary(b)}
                  {b.status === "sent" && typeof b.stats?.delivered === "number" ? ` · ${b.stats.delivered} delivered` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {(b.status === "draft" || b.status === "scheduled") && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm({ b, action: "send" })}><Send className="size-3.5" /> Send now</Button>
                  </>
                )}
                {b.status === "scheduled" && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm({ b, action: "cancel" })}><X className="size-3.5" /> Cancel</Button>
                )}
                {b.status !== "sending" && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirm({ b, action: "delete" })}><Trash2 className="size-3.5" /></Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <BroadcastComposer
          broadcast={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "send" ? "Send this broadcast now?" : confirm?.action === "delete" ? "Delete this broadcast?" : "Cancel this scheduled broadcast?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "send"
                ? `“${confirm?.b.title}” will be delivered immediately to ${audienceSummary(confirm.b.audience).toLowerCase()}.`
                : confirm?.b.title}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction onClick={doConfirm} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {confirm?.action === "send" ? "Send now" : confirm?.action === "delete" ? "Delete" : "Cancel broadcast"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type ScheduleType = "now" | "at" | "recurring"

function BroadcastComposer({
  broadcast,
  onClose,
  onSaved,
}: {
  broadcast: Broadcast | null
  onClose: () => void
  onSaved: () => void
}) {
  const { getToken } = useAuth()

  // Open AFTER mount (false → true) so the shared Dialog's useBackClose sees a real
  // open transition. Mounting already-open makes its StrictMode effect cleanup run
  // history.back() and immediately close the modal.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(true)
  }, [])

  const [title, setTitle] = useState(broadcast?.title ?? "")
  const [body, setBody] = useState(broadcast?.body ?? "")
  const [imageUrl, setImageUrl] = useState(broadcast?.image_url ?? "")
  const [link, setLink] = useState(broadcast?.link ?? "")
  const [linkType, setLinkType] = useState<"internal" | "external">(broadcast?.link_type ?? "internal")
  const [importance, setImportance] = useState(broadcast?.importance ?? false)

  // Audience
  const initAud = broadcast?.audience ?? { type: "all" as const }
  const [audType, setAudType] = useState<BroadcastAudience["type"]>(initAud.type)
  const [groupId, setGroupId] = useState(initAud.type === "group" ? initAud.groupId : "")
  // Hydrate the picked-users selection when editing a "specific users" broadcast so
  // saving doesn't wipe the stored list. We only have the ids (no batch user-by-id
  // endpoint), so chips fall back to showing the id until the admin searches.
  const [pickedUsers, setPickedUsers] = useState<UserRow[]>(() =>
    initAud.type === "users" ? initAud.userIds.map((id) => ({ id, email: "", fullName: null })) : [],
  )
  const [groups, setGroups] = useState<Group[]>([])

  // Schedule
  const initSched = broadcast?.schedule ?? { type: "now" as const }
  const [schedType, setSchedType] = useState<ScheduleType>(initSched.type)
  const [at, setAt] = useState(toLocalInput(initSched.type !== "now" ? initSched.at : null))
  const [freq, setFreq] = useState<BroadcastRecurrence["freq"]>(initSched.type === "recurring" ? initSched.recurring.freq : "daily")
  const [interval, setInterval] = useState(initSched.type === "recurring" ? initSched.recurring.interval : 1)
  const [until, setUntil] = useState(toLocalInput(initSched.type === "recurring" ? initSched.recurring.until : null))

  const [saving, setSaving] = useState<null | "draft" | "schedule" | "send">(null)

  // User search (for audience = users)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<UserRow[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ groups: Group[] }>("/api/admin/user-groups", token)
        setGroups(res.groups ?? [])
      } catch {
        /* ignore */
      }
    })()
  }, [getToken])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!search.trim()) {
      setResults([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ data: UserRow[] }>(`/api/admin/users?search=${encodeURIComponent(search.trim())}`, token)
        setResults(res.data ?? [])
      } catch {
        setResults([])
      }
    }, 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search, getToken])

  const buildAudience = (): BroadcastAudience => {
    if (audType === "users") return { type: "users", userIds: pickedUsers.map((u) => u.id) }
    if (audType === "group") return { type: "group", groupId }
    if (audType === "push_enabled") return { type: "push_enabled" }
    return { type: "all" }
  }
  const buildSchedule = (): BroadcastSchedule => {
    if (schedType === "at") return { type: "at", at: fromLocalInput(at) ?? new Date().toISOString() }
    if (schedType === "recurring")
      return { type: "recurring", at: fromLocalInput(at) ?? new Date().toISOString(), recurring: { freq, interval: Math.max(1, interval), until: fromLocalInput(until) } }
    return { type: "now" }
  }

  const submit = async (mode: "draft" | "schedule" | "send") => {
    if (!title.trim()) return toast.error("A title is required.")
    if (audType === "users" && pickedUsers.length === 0) return toast.error("Select at least one user.")
    if (audType === "group" && !groupId) return toast.error("Choose a group.")
    if ((mode === "schedule") && schedType !== "now" && !at) return toast.error("Pick a date and time.")
    setSaving(mode)
    try {
      const token = await getToken()
      if (!token) return
      const payload = {
        title: title.trim(),
        body,
        image_url: imageUrl.trim() || null,
        link: link.trim() || null,
        link_type: linkType,
        importance,
        audience: buildAudience(),
        schedule: buildSchedule(),
        mode,
      }
      if (broadcast) await apiPatch(`/api/admin/broadcasts/${broadcast.id}`, token, payload)
      else await apiPost("/api/admin/broadcasts", token, payload)
      toast.success(mode === "send" ? "Broadcast sent" : mode === "schedule" ? "Broadcast scheduled" : "Draft saved")
      onSaved()
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't save the broadcast")
    } finally {
      setSaving(null)
    }
  }

  const editingSent = broadcast?.status === "sent" || broadcast?.status === "sending"

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{broadcast ? "Edit broadcast" : "New broadcast"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Content */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bc-title">Title</Label>
              <Input id="bc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="What's new?" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-body">Message</Label>
              <Textarea id="bc-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} placeholder="Write the notification body…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-image">Image URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="bc-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/banner.png" />
              {imageUrl.trim() && (
                <img src={imageUrl} alt="" className="mt-1 max-h-32 rounded-md border object-cover" onError={(e) => (e.currentTarget.style.display = "none")} onLoad={(e) => (e.currentTarget.style.display = "")} />
              )}
            </div>
          </div>

          {/* Click action */}
          <div className="space-y-1.5">
            <Label>On click, open</Label>
            <div className="flex gap-2">
              <NativeSelect value={linkType} onChange={(e) => setLinkType(e.target.value as "internal" | "external")} className="w-40">
                <option value="internal">In-app route</option>
                <option value="external">External URL</option>
              </NativeSelect>
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={linkType === "internal" ? "/dashboard" : "https://example.com"}
                className="flex-1"
              />
            </div>
          </div>

          {/* Importance */}
          <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 text-amber-500" />
              <div>
                <p className="text-sm font-medium">Mark as important</p>
                <p className="text-xs text-muted-foreground">Reaches users even if they muted this category (always in the bell; push attempted).</p>
              </div>
            </div>
            <Switch checked={importance} onCheckedChange={setImportance} aria-label="Mark as important" />
          </div>

          {/* Audience */}
          <div className="space-y-2">
            <Label>Audience</Label>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "Everyone"],
                ["push_enabled", "Push-enabled"],
                ["users", "Specific users"],
                ["group", "Saved group"],
              ] as [BroadcastAudience["type"], string][]).map(([val, lbl]) => (
                <Button key={val} type="button" size="sm" variant={audType === val ? "default" : "outline"} onClick={() => setAudType(val)}>
                  {lbl}
                </Button>
              ))}
            </div>

            {audType === "group" && (
              <NativeSelect value={groupId} onChange={(e) => setGroupId(e.target.value)} className="mt-1">
                <option value="">Choose a group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} ({g.member_count})</option>
                ))}
              </NativeSelect>
            )}

            {audType === "users" && (
              <div className="mt-1 space-y-2">
                {pickedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
                    {pickedUsers.map((u) => (
                      <Badge key={u.id} variant="secondary" className="gap-1 pr-1">
                        <span className="max-w-[12rem] truncate">{u.fullName || u.email || u.id}</span>
                        <button type="button" onClick={() => setPickedUsers((p) => p.filter((x) => x.id !== u.id))} aria-label="Remove"><X className="size-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users by name or email…" />
                {results.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    {results.map((u) => {
                      const added = pickedUsers.some((p) => p.id === u.id)
                      return (
                        <button key={u.id} type="button" disabled={added} onClick={() => setPickedUsers((p) => [...p, u])} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50">
                          <span className="min-w-0"><span className="block truncate font-medium">{u.fullName || u.email}</span><span className="block truncate text-xs text-muted-foreground">{u.email}</span></span>
                          {added ? <span className="text-xs text-muted-foreground">Added</span> : <Plus className="size-4 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="space-y-2">
            <Label>When</Label>
            <div className="flex flex-wrap gap-2">
              {([
                ["now", "Send now"],
                ["at", "Schedule"],
                ["recurring", "Recurring"],
              ] as [ScheduleType, string][]).map(([val, lbl]) => (
                <Button key={val} type="button" size="sm" variant={schedType === val ? "default" : "outline"} onClick={() => setSchedType(val)}>
                  {lbl}
                </Button>
              ))}
            </div>
            {schedType !== "now" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-at" className="text-xs">{schedType === "recurring" ? "Starting" : "Date & time"}</Label>
                  <Input id="bc-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                </div>
                {schedType === "recurring" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Repeat</Label>
                      <div className="flex gap-2">
                        <Input type="number" min={1} value={interval} onChange={(e) => setInterval(parseInt(e.target.value, 10) || 1)} className="w-20" />
                        <NativeSelect value={freq} onChange={(e) => setFreq(e.target.value as BroadcastRecurrence["freq"])} className="flex-1">
                          <option value="daily">day(s)</option>
                          <option value="weekly">week(s)</option>
                          <option value="monthly">month(s)</option>
                        </NativeSelect>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bc-until" className="text-xs">Until <span className="text-muted-foreground">(optional)</span></Label>
                      <Input id="bc-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onClose} disabled={saving !== null}>Cancel</Button>
          {!editingSent && (
            <Button variant="outline" onClick={() => submit("draft")} disabled={saving !== null}>
              {saving === "draft" && <Loader2 className="size-4 animate-spin" />} Save draft
            </Button>
          )}
          {schedType === "now" ? (
            <Button onClick={() => submit("send")} disabled={saving !== null}>
              {saving === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send now
            </Button>
          ) : (
            <Button onClick={() => submit("schedule")} disabled={saving !== null}>
              {saving === "schedule" && <Loader2 className="size-4 animate-spin" />} Schedule
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
