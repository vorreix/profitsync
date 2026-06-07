import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ChevronDown, Download, Paperclip, Upload, X } from "lucide-react"
import { apiGet } from "@/lib/api"
import type { WealthAccount, WealthAccountAttachment } from "@/lib/types"
import { accountFieldsForCountry, PRIMARY_LABEL_KEY, SECONDARY_LABEL_KEY } from "@/lib/bank-fields"
import { countryByCode } from "@/lib/countries"
import { ACCEPT_ATTR, attachmentsListPath, uploadAttachment, validateFile } from "@/lib/attachments-client"
import { usePersistedOpen } from "@/lib/wealth"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"

const formatFileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium">{value}</span>
    </div>
  )
}

/** Bank details card + document attachments, shown on the account-detail page. */
export function AccountDetailsSection({
  account,
  canWrite,
  canDelete,
}: {
  account: WealthAccount
  canWrite: boolean
  canDelete: boolean
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const [attachments, setAttachments] = useState<WealthAccountAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [viewAttachment, setViewAttachment] = useState<AttachmentModalItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Persist the collapse state per account (survives navigation + restart).
  const [detailsOpen, setDetailsOpen] = usePersistedOpen(`ps_wealth_detail_open_${account.id}`, true)
  const [filesOpen, setFilesOpen] = usePersistedOpen(`ps_wealth_files_open_${account.id}`, true)

  const loadAttachments = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      setAttachments(await apiGet<WealthAccountAttachment[]>(attachmentsListPath("wealth_account", account.id), token))
    } catch {
      /* non-blocking */
    } finally {
      setLoading(false)
    }
  }, [getToken, account.id])

  useEffect(() => { loadAttachments() }, [loadAttachments])

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files || [])
    if (fileRef.current) fileRef.current.value = ""
    const valid = files.filter((f) => { const err = validateFile(f); if (err) toast.error(err); return !err })
    if (!valid.length) return
    setUploading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      let ok = 0
      for (const file of valid) {
        try { await uploadAttachment(attachmentsListPath("wealth_account", account.id), file, token); ok++ }
        catch (err) { toast.error(err instanceof Error ? err.message : `Failed to attach ${file.name}`) }
      }
      if (ok > 0) { toast.success(t("fileAttached")); loadAttachments() }
    } finally {
      setUploading(false)
    }
  }

  const fields = accountFieldsForCountry(account.country)
  const country = countryByCode(account.country ?? "")
  const hasDetails = !!(account.country || account.account_number || account.routing_number || account.swift || account.location || account.address || account.note)

  return (
    <>
      {hasDetails && (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="rounded-2xl border">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 p-4 text-left sm:p-5">
            <h2 className="text-sm font-semibold">{t("accountDetails")}</h2>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="divide-y">
              {country && <DetailRow label={t("country")} value={`${country.flag} ${country.name}`} />}
              <DetailRow label={t(PRIMARY_LABEL_KEY[fields.primaryKey])} value={account.account_number ?? ""} />
              {fields.secondaryKey && <DetailRow label={t(SECONDARY_LABEL_KEY[fields.secondaryKey])} value={account.routing_number ?? ""} />}
              <DetailRow label={t("fieldSwift")} value={account.swift ?? ""} />
              <DetailRow label={t("location")} value={account.location ?? ""} />
              <DetailRow label={t("address")} value={account.address ?? ""} />
              <DetailRow label={t("note")} value={account.note ?? ""} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible open={filesOpen} onOpenChange={setFilesOpen} className="rounded-2xl border">
        <div className="flex items-center justify-between gap-2 p-4 sm:p-5">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <Paperclip className="size-3.5 shrink-0" />
            <h2 className="text-sm font-semibold">{t("attachments")}</h2>
            {attachments.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{attachments.length}</span>
            )}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          {canWrite && (
            <>
              <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={onPickFiles} />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" /> {uploading ? t("saving") : t("addFiles")}
              </Button>
            </>
          )}
        </div>
        <CollapsibleContent className="px-4 pb-4 sm:px-5 sm:pb-5">
        {loading ? (
          <div className="space-y-1.5">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
        ) : attachments.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">{t("noFilesYet")}</p>
        ) : (
          <div className="space-y-1.5">
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setViewAttachment({
                    id: att.id, source: "wealth_account", source_id: account.id, source_label: account.bank_name,
                    file_name: att.file_name, file_type: att.file_type, file_size: att.file_size,
                    created_at: att.created_at, display_name: att.display_name, tags: att.tags, category: att.category,
                  })}
                >
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{att.display_name || att.file_name}</span>
                    <span className="block text-xs text-muted-foreground">{formatFileSize(att.file_size)}</span>
                  </span>
                  <Download className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                    onClick={() => setViewAttachment({
                      id: att.id, source: "wealth_account", source_id: account.id, source_label: account.bank_name,
                      file_name: att.file_name, file_type: att.file_type, file_size: att.file_size,
                      created_at: att.created_at, display_name: att.display_name, tags: att.tags, category: att.category,
                    })}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        </CollapsibleContent>
      </Collapsible>

      <AttachmentDetailModal
        item={viewAttachment}
        open={viewAttachment !== null}
        onOpenChange={(o) => { if (!o) setViewAttachment(null) }}
        canEdit={canWrite}
        canDelete={canDelete}
        onUpdated={loadAttachments}
        onDeleted={() => { setViewAttachment(null); loadAttachments() }}
      />
    </>
  )
}
