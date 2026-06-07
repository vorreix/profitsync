import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Paperclip, Upload } from "lucide-react"

import { apiGet } from "@/lib/api"
import type { TransactionAttachment } from "@/lib/types"
import { ACCEPT_ATTR, attachmentsListPath, uploadAttachment, validateFile } from "@/lib/attachments-client"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const formatFileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Inline attachment manager for a single transaction: list + add files; clicking
 * an item opens AttachmentDetailModal (preview, download, rename, delete). Shared
 * so the edit dialog gets the same capabilities as the detail view.
 */
export function TransactionAttachments({
  txId,
  txLabel,
  canEdit,
  canDelete,
}: {
  txId: string
  txLabel: string
  canEdit: boolean
  canDelete: boolean
}) {
  const { t } = useTranslation("transactions")
  const { getToken } = useAuth()
  const [attachments, setAttachments] = useState<TransactionAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [view, setView] = useState<AttachmentModalItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      setAttachments(await apiGet<TransactionAttachment[]>(`/api/transactions/${txId}/attachments`, token))
    } catch {
      /* non-blocking */
    } finally {
      setLoading(false)
    }
  }, [getToken, txId])

  useEffect(() => {
    load()
  }, [load])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files || [])
    if (fileRef.current) fileRef.current.value = ""
    const valid = files.filter((f) => {
      const err = validateFile(f)
      if (err) toast.error(err)
      return !err
    })
    if (!valid.length) return
    setUploading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      let ok = 0
      for (const file of valid) {
        try {
          await uploadAttachment(attachmentsListPath("transaction", txId), file, token)
          ok++
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Failed to attach ${file.name}`)
        }
      }
      if (ok > 0) {
        toast.success(t("attachmentUploaded"))
        load()
      }
    } finally {
      setUploading(false)
    }
  }

  const toItem = (att: TransactionAttachment): AttachmentModalItem => ({
    id: att.id,
    source: "transaction",
    source_id: txId,
    source_label: txLabel,
    file_name: att.file_name,
    file_type: att.file_type,
    file_size: att.file_size,
    created_at: att.created_at,
    display_name: att.display_name,
    tags: att.tags,
    category: att.category,
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip className="size-3.5" /> {t("attachments")}
        </p>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={onPick} />
            <Button size="sm" variant="outline" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> {uploading ? t("uploading") : t("addFiles")}
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-1.5">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
      ) : attachments.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">{t("noAttachmentsYet")}</p>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <button
              key={att.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50"
              onClick={() => setView(toItem(att))}
            >
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{att.display_name || att.file_name}</span>
                <span className="block text-xs text-muted-foreground">{formatFileSize(att.file_size)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("max2MBPerFile")}</p>

      <AttachmentDetailModal
        item={view}
        open={view !== null}
        onOpenChange={(o) => { if (!o) setView(null) }}
        canEdit={canEdit}
        canDelete={canDelete}
        onUpdated={load}
        onDeleted={() => { setView(null); load() }}
      />
    </div>
  )
}
