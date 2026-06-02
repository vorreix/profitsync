import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  Download,
  Trash2,
  ExternalLink,
  FileText,
  Loader,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
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
import { Badge } from "@/components/ui/badge"
import { apiPatch, apiDelete } from "@/lib/api"
import {
  attachmentItemPath,
  fetchAttachmentBlob,
  type AttachmentParent,
} from "@/lib/attachments-client"

export type AttachmentModalItem = {
  id: string
  source: AttachmentParent
  source_id: string
  source_label?: string
  file_name: string
  file_type: string
  file_size: number
  created_at?: string
  display_name?: string | null
  tags?: string[]
  category?: string
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Deep-linkable attachment detail: inline preview (image / pdf / text), editable
 * display name, category and tags, a link to the related entity, plus download
 * and delete. The file bytes are immutable — only metadata can be edited.
 */
export function AttachmentDetailModal({
  item,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
  canEdit,
  canDelete,
}: {
  item: AttachmentModalItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated?: (item: AttachmentModalItem) => void
  onDeleted?: (id: string) => void
  canEdit: boolean
  canDelete: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [tagsText, setTagsText] = useState("")
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const objectUrlRef = useRef<string | null>(null)

  const type = item?.file_type ?? ""
  const isImage = type.startsWith("image/")
  const isPdf = type === "application/pdf"
  const isText = type === "text/plain" || type === "text/csv"
  const canPreview = isImage || isPdf || isText

  // Seed editable fields when the item changes.
  useEffect(() => {
    if (!item) return
    setName(item.display_name || item.file_name)
    setCategory(item.category || "")
    setTagsText((item.tags || []).join(", "))
  }, [item])

  // Lazily load a preview when the modal opens.
  useEffect(() => {
    if (!open || !item || !canPreview) return
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(false)
    setPreviewText(null)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) throw new Error("no token")
        const blob = await fetchAttachmentBlob(item.source, item.id, token)
        if (cancelled) return
        if (isText) {
          const text = await blob.text()
          if (!cancelled) setPreviewText(text.slice(0, 20000))
        } else {
          const url = URL.createObjectURL(blob)
          objectUrlRef.current = url
          if (!cancelled) setPreviewUrl(url)
        }
      } catch {
        if (!cancelled) setPreviewError(true)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
      setPreviewUrl(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  if (!item) return null

  async function handleDownload() {
    if (!item) return
    try {
      const token = await getToken()
      if (!token) return
      const blob = await fetchAttachmentBlob(item.source, item.id, token)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = item.file_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t("attachments.downloadFailed"))
    }
  }

  async function handleSave() {
    if (!item) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const tags = tagsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const updated = await apiPatch<AttachmentModalItem>(attachmentItemPath(item.source, item.id), token, {
        display_name: name.trim(),
        category: category.trim(),
        tags,
      })
      toast.success(t("attachments.saved"))
      onUpdated?.({ ...item, display_name: updated.display_name, category: updated.category, tags: updated.tags })
      onOpenChange(false)
    } catch {
      toast.error(t("attachments.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!item) return
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(attachmentItemPath(item.source, item.id), token)
      toast.success(t("attachments.deleted"))
      onDeleted?.(item.id)
      onOpenChange(false)
    } catch {
      toast.error(t("attachments.deleteFailed"))
    }
  }

  function openEntity() {
    if (!item) return
    onOpenChange(false)
    if (item.source === "transaction") navigate(`/transactions?view=${item.source_id}`)
    else if (item.source === "quotation") navigate(`/quotations?view=${item.source_id}`)
    else navigate(`/clients/${item.source_id}`)
  }

  const tags = (item.tags || [])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[94vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6 break-all">
              <FileText className="size-4 shrink-0" />
              {item.display_name || item.file_name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Preview */}
            <div className="rounded-lg border bg-muted/40 p-3 min-h-32 flex items-center justify-center">
              {previewLoading ? (
                <Loader className="size-5 animate-spin text-muted-foreground" />
              ) : previewError ? (
                <p className="text-sm text-muted-foreground">{t("attachments.previewUnavailable")}</p>
              ) : isImage && previewUrl ? (
                <img src={previewUrl} alt={item.file_name} className="max-h-80 max-w-full rounded object-contain" />
              ) : isPdf && previewUrl ? (
                <iframe src={previewUrl} title={item.file_name} sandbox="" className="h-80 w-full rounded" />
              ) : isText && previewText !== null ? (
                <pre className="max-h-80 w-full overflow-auto whitespace-pre-wrap break-words text-xs">{previewText}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">{t("attachments.noPreview")}</p>
              )}
            </div>

            {/* Meta summary */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t("attachments.fileName")}: <span className="text-foreground break-all">{item.file_name}</span></span>
              <span>{t("attachments.size")}: <span className="text-foreground">{formatSize(item.file_size)}</span></span>
              {item.created_at && (
                <span>{t("attachments.added")}: <span className="text-foreground">{new Date(item.created_at).toLocaleDateString()}</span></span>
              )}
              {item.source_label && (
                <span>{t("attachments.source")}: <span className="text-foreground">{item.source_label}</span></span>
              )}
            </div>

            {/* Editable metadata */}
            {canEdit ? (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="att-name">{t("attachments.displayName")}</Label>
                  <Input id="att-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="att-cat">{t("attachments.category")}</Label>
                  <Input id="att-cat" value={category} maxLength={60} placeholder={t("attachments.categoryPlaceholder")} onChange={(e) => setCategory(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="att-tags">{t("attachments.tags")}</Label>
                  <Input id="att-tags" value={tagsText} placeholder={t("attachments.tagsPlaceholder")} onChange={(e) => setTagsText(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground">{t("attachments.tagsHint")}</p>
                </div>
              </div>
            ) : (
              (category || tags.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
                  {category && <Badge variant="secondary">{category}</Badge>}
                  {tags.map((tg) => <Badge key={tg} variant="outline">{tg}</Badge>)}
                </div>
              )
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="size-4" /> {t("attachments.download")}
              </Button>
              <Button variant="outline" size="sm" onClick={openEntity}>
                <ExternalLink className="size-4" /> {t("attachments.openRelated")}
              </Button>
              {canDelete && (
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" /> {t("attachments.delete")}
                </Button>
              )}
              {canEdit && (
                <Button size="sm" className="ml-auto" onClick={handleSave} disabled={saving}>
                  {saving ? t("common.saving") : t("common.save")}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("attachments.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("attachments.deleteBody", { name: item.display_name || item.file_name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              {t("attachments.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
