import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Building2, Mail, Phone, Calendar, FileText, Pencil, Paperclip, Upload, Loader, FolderOpen, Tag } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FitText } from "@/components/FitText"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import { useCurrency } from "@/lib/currency-context"
import { apiGet, clearApiCache } from "@/lib/api"
import {
  ACCEPT_ATTR,
  attachmentsListPath,
  uploadAttachment,
  validateFile,
} from "@/lib/attachments-client"
import type { Client, ClientAttachment } from "@/lib/types"

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
const formatSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`)

/**
 * Rich, read-only client overview (the "eye" action on the detail page). Shows
 * every field, the financial summary, and a documents section (client-level
 * attachments) with upload + per-file detail (rename/tags/delete via the
 * attachment modal). An "Edit" button hands off to the client edit form.
 */
export function ClientOverviewModal({
  client,
  open,
  onOpenChange,
  onEdit,
  canModify,
  canRemove,
  onFiles,
}: {
  client: Client | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  canModify: boolean
  canRemove: boolean
  onFiles?: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [docs, setDocs] = useState<ClientAttachment[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [viewDoc, setViewDoc] = useState<AttachmentModalItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadDocs = useCallback(async () => {
    if (!client) return
    setDocsLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const rows = await apiGet<ClientAttachment[]>(`/api/clients/${client.id}/attachments`, token)
      setDocs(rows)
    } catch {
      /* ignore */
    } finally {
      setDocsLoading(false)
    }
  }, [client, getToken])

  useEffect(() => {
    if (open && client) loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id])

  if (!client) return null

  const incoming = Number(client.total_incoming ?? 0)
  const outgoing = Number(client.total_outgoing ?? 0)
  const profit = incoming - outgoing

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (fileRef.current) fileRef.current.value = ""
    if (!files.length || !client) return
    const token = await getToken()
    if (!token) return
    setUploading(true)
    let n = 0
    for (const file of files) {
      const err = validateFile(file)
      if (err) { toast.error(err); continue }
      try { await uploadAttachment(attachmentsListPath("client", client.id), file, token); n++ } catch (er) { toast.error(er instanceof Error ? er.message : "Upload failed") }
    }
    if (n > 0) { clearApiCache(); toast.success(t("attachments.uploaded", { defaultValue: "Uploaded" })); await loadDocs() }
    setUploading(false)
  }

  const rows: { icon: typeof Mail; value: string }[] = [
    client.company ? { icon: Building2, value: client.company } : null,
    client.email ? { icon: Mail, value: client.email } : null,
    client.phone ? { icon: Phone, value: client.phone } : null,
    client.onboard_date ? { icon: Calendar, value: `Onboarded ${formatDate(client.onboard_date)}` } : null,
    { icon: Calendar, value: `Client since ${formatDate(client.created_at)}` },
  ].filter(Boolean) as { icon: typeof Mail; value: string }[]

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[94vw] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
              <span className="truncate">{client.name}</span>
              <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs">{client.status}</Badge>
              {client.closed_at && <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-300">Closed</Badge>}
              {client.category && <Badge variant="outline" className="text-xs">{client.category}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border p-2.5 min-w-0">
                <p className="text-[11px] text-muted-foreground">Income</p>
                <FitText className="text-emerald-600 dark:text-emerald-400 mt-0.5" textClassName="text-sm font-semibold tabular-nums">{fmt(incoming)}</FitText>
              </div>
              <div className="rounded-lg border p-2.5 min-w-0">
                <p className="text-[11px] text-muted-foreground">Expense</p>
                <FitText className="text-red-600 dark:text-red-400 mt-0.5" textClassName="text-sm font-semibold tabular-nums">{fmt(outgoing)}</FitText>
              </div>
              <div className="rounded-lg border p-2.5 min-w-0">
                <p className="text-[11px] text-muted-foreground">Profit</p>
                <FitText className={`mt-0.5 ${profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} textClassName="text-sm font-semibold tabular-nums">{fmt(profit)}</FitText>
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2.5 text-sm">
                  <r.icon className="size-4 text-muted-foreground shrink-0" />
                  <span className="break-words min-w-0">{r.value}</span>
                </div>
              ))}
              {client.notes && (
                <div className="flex items-start gap-2.5 text-sm">
                  <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap break-words min-w-0">{client.notes}</span>
                </div>
              )}
            </div>

            {/* Documents */}
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium flex items-center gap-1.5"><Paperclip className="size-3.5" /> Documents</p>
                {canModify && (
                  <>
                    <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <Loader className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload
                    </Button>
                    <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={onUpload} />
                  </>
                )}
              </div>
              {docsLoading ? (
                <p className="text-xs text-muted-foreground py-2">{t("categories.loading")}</p>
              ) : docs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No documents yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => setViewDoc({
                          id: d.id, source: "client", source_id: client.id, source_label: "Client document",
                          file_name: d.file_name, file_type: d.file_type, file_size: d.file_size,
                          created_at: d.created_at, display_name: d.display_name, tags: d.tags, category: d.category,
                        })}
                      >
                        <Tag className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-xs font-medium">{d.display_name || d.file_name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatSize(d.file_size)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {onFiles && (
                <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); onFiles() }}>
                  <FolderOpen className="size-4" /> All files
                </Button>
              )}
              <Button size="sm" className="ml-auto" onClick={() => { onOpenChange(false); onEdit() }}>
                <Pencil className="size-4" /> {t("categories.edit", { defaultValue: "Edit" })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AttachmentDetailModal
        item={viewDoc}
        open={viewDoc !== null}
        onOpenChange={(o) => { if (!o) setViewDoc(null) }}
        canEdit={canModify}
        canDelete={canRemove}
        onUpdated={loadDocs}
        onDeleted={() => { setViewDoc(null); loadDocs() }}
      />
    </>
  )
}
