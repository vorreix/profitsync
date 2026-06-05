import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { ArrowDownRight, ArrowUpRight, Paperclip, Pencil } from "lucide-react"
import type { Transaction, TransactionAttachment } from "@/lib/types"
import { apiGet } from "@/lib/api"
import { accountDisplayName } from "@/lib/wealth"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { AuditHistory } from "@/components/AuditHistory"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/**
 * Read-only transaction detail with attachments + audit history. Self-loads its
 * attachments; opening an attachment routes through AttachmentDetailModal.
 * Shared so the wealth account-detail page matches the rest of the app.
 */
export function TransactionDetailModal({
  tx,
  open,
  onClose,
  currency,
  canEdit = false,
  canDelete = false,
  onEdit,
}: {
  tx: Transaction | null
  open: boolean
  onClose: () => void
  currency: string
  canEdit?: boolean
  canDelete?: boolean
  onEdit?: (tx: Transaction) => void
}) {
  const { t } = useTranslation("transactions")
  const { getToken } = useAuth()
  const [attachments, setAttachments] = useState<TransactionAttachment[]>([])
  const [viewAttachment, setViewAttachment] = useState<AttachmentModalItem | null>(null)
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n)

  const loadAttachments = async (txId: string) => {
    setAttachments([])
    const token = await getToken()
    if (!token) return
    try {
      setAttachments(await apiGet<TransactionAttachment[]>(`/api/transactions/${txId}/attachments`, token))
    } catch {
      /* non-blocking */
    }
  }

  useEffect(() => {
    if (open && tx) loadAttachments(tx.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tx?.id])

  const accountLabel = tx?.wealth_account_name?.trim() || tx?.wealth_account_bank_name?.trim()

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="w-[92vw] max-w-sm sm:max-w-md">
          {tx && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={`flex size-7 items-center justify-center rounded-full ${tx.type === "incoming" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                    {tx.type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  </span>
                  {t("transactionDetails")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className={`text-2xl font-bold tabular-nums ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {tx.type === "incoming" ? "+" : "−"}{fmt(Number(tx.amount))}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("date")}</p>
                    <p className="font-medium">{formatDate(tx.date)}</p>
                  </div>
                  {tx.category && (
                    <div>
                      <p className="text-xs text-muted-foreground">{t("category")}</p>
                      <Badge variant="outline">{tx.category}</Badge>
                    </div>
                  )}
                  {accountLabel && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">{t("account")}</p>
                      <span className="mt-0.5 inline-flex items-center gap-1.5">
                        <WealthAccountIcon
                          account={{ type: tx.wealth_account_type ?? "bank", icon: tx.wealth_account_icon ?? "bank" }}
                          className="size-6"
                        />
                        <span className="text-sm font-medium">
                          {accountDisplayName({ bank_name: tx.wealth_account_bank_name ?? "", nickname: tx.wealth_account_name ?? "" })}
                        </span>
                      </span>
                    </div>
                  )}
                  {tx.client_name && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">{t("client")}</p>
                      <p className="text-sm font-medium">{tx.client_name}</p>
                    </div>
                  )}
                </div>
                {tx.description && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("description")}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{tx.description}</p>
                  </div>
                )}
                <div className="space-y-1.5 border-t pt-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium"><Paperclip className="size-3.5" /> {t("attachments")}</p>
                  {attachments.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">{t("noAttachmentsYet")}</p>
                  ) : attachments.map((att) => (
                    <button
                      key={att.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left"
                      onClick={() => setViewAttachment({
                        id: att.id, source: "transaction", source_id: tx.id,
                        source_label: tx.description?.trim() || (tx.type === "incoming" ? t("income") : t("expense")),
                        file_name: att.file_name, file_type: att.file_type, file_size: att.file_size,
                        created_at: att.created_at, display_name: att.display_name, tags: att.tags, category: att.category,
                      })}
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{att.display_name || att.file_name}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-sm font-medium">{t("history")}</p>
                  <AuditHistory entityType="transaction" entityId={tx.id} />
                </div>
              </div>
              <DialogFooter>
                {canEdit && onEdit && !tx.is_system && (
                  <Button variant="outline" onClick={() => onEdit(tx)}>
                    <Pencil className="size-3.5" /> {t("edit")}
                  </Button>
                )}
                <Button onClick={onClose}>{t("close")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttachmentDetailModal
        item={viewAttachment}
        open={viewAttachment !== null}
        onOpenChange={(o) => { if (!o) setViewAttachment(null) }}
        canEdit={canEdit}
        canDelete={canDelete}
        onUpdated={() => { if (tx) loadAttachments(tx.id) }}
        onDeleted={() => { setViewAttachment(null); if (tx) loadAttachments(tx.id) }}
      />
    </>
  )
}
