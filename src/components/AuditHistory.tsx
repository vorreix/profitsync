import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth, useUser } from "@clerk/clerk-react"
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, History } from "lucide-react"
import { apiGet } from "@/lib/api"

type AuditEntry = {
  id: string
  action: "create" | "update" | "delete" | "close" | "reopen"
  actor_user_id: string | null
  changes: Record<string, { from: unknown; to: unknown }>
  created_at: string
}

const ACTION_ICON = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  close: Archive,
  reopen: ArchiveRestore,
} as const

const actionLabelKey = (a: AuditEntry["action"]) =>
  a === "create" ? "audit.created"
  : a === "update" ? "audit.updated"
  : a === "delete" ? "audit.deleted"
  : a === "close" ? "audit.closed"
  : "audit.reopened"

function fmtWhen(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Append-only change history for a client / transaction / quotation. */
export function AuditHistory({ entityType, entityId }: { entityType: "client" | "transaction" | "quotation"; entityId: string }) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const token = await getToken()
        if (!token) return
        const rows = await apiGet<AuditEntry[]>(`/api/audit?entity_type=${entityType}&entity_id=${entityId}`, token)
        if (!cancelled) setEntries(rows)
      } catch {
        if (!cancelled) setEntries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [entityType, entityId, getToken])

  const val = (v: unknown) => {
    const s = v == null ? "" : String(v)
    return s.trim() === "" ? t("audit.empty_value") : s.length > 40 ? s.slice(0, 40) + "…" : s
  }
  const fieldLabel = (f: string) => t(`audit.fields.${f}`, { defaultValue: f })

  if (loading) return <p className="text-xs text-muted-foreground py-2">…</p>
  if (entries.length === 0) return <p className="text-xs text-muted-foreground py-2">{t("audit.empty")}</p>

  return (
    <ol className="space-y-3">
      {entries.map((e) => {
        const Icon = ACTION_ICON[e.action] ?? History
        const who = e.actor_user_id && user?.id === e.actor_user_id ? t("audit.you") : t("audit.teammate")
        const changeKeys = Object.keys(e.changes ?? {})
        return (
          <li key={e.id} className="flex gap-2.5 text-sm">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="leading-tight">
                <span className="font-medium">{t(actionLabelKey(e.action))}</span>
                <span className="text-muted-foreground"> · {who} · {fmtWhen(e.created_at)}</span>
              </p>
              {e.action === "update" && changeKeys.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {changeKeys.map((k) => (
                    <li key={k} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{fieldLabel(k)}:</span> {val(e.changes[k].from)} → {val(e.changes[k].to)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
