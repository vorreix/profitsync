import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowRight, CalendarClock, Check, Clock, MoreVertical, X } from "lucide-react"
import { apiErrorMessage, apiPatch } from "@/lib/api"
import { AmountError, type AmountField, amountInputProps, transferAmounts } from "@/lib/money"
import type { Transfer, TransferStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { formatDateLabel, formatMoney, formatRate } from "@/lib/wealth"
import { useApiQuery } from "@/hooks/use-api-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { isCrossCurrency } from "@/components/wealth/transfer-utils"

const LIST_PATH = "/api/wealth/transfers"

/**
 * The transfers that are planned or pending — intent only, no money moved yet.
 * Each row is from → to with native amounts (+ fee), the date, a status chip and
 * the lifecycle actions: Mark done (→ completed: legs + balances land), Mark
 * pending (planned only), Cancel (kept in history as cancelled).
 *
 * Updates are optimistic and in place: a row leaves the list (or flips its
 * chip) the moment the user acts; the write's fan-out refreshes the list behind
 * it, and a failure puts the row back with a toast.
 */
export function ScheduledTransfersPanel({ canWrite, visible, className }: { canWrite: boolean; visible: boolean; className?: string }) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const { data, loading } = useApiQuery<{ transfers: Transfer[] }>(LIST_PATH)
  // id → status the user just chose; overrides the server copy until it catches up.
  const [overrides, setOverrides] = useState<Record<string, TransferStatus>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<Transfer | null>(null)
  const [completing, setCompleting] = useState<Transfer | null>(null)

  const rows = (data?.transfers ?? [])
    .map((tr) => ({ ...tr, status: overrides[tr.id] ?? tr.status }))
    .filter((tr) => tr.status === "planned" || tr.status === "pending")

  if (loading || rows.length === 0) return null

  async function transition(tr: Transfer, status: "pending" | "completed" | "cancelled", facts?: { destination_amount: string; source_fee_amount: string }) {
    const previous = tr.status
    setOverrides((o) => ({ ...o, [tr.id]: status }))
    setBusy(tr.id)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/wealth/transfers/${tr.id}`, token, { status, ...facts })
      toast.success(status === "completed" ? t("transferMarkedDone") : status === "pending" ? t("transferMarkedPending") : t("transferCancelled"))
    } catch (err) {
      setOverrides((o) => ({ ...o, [tr.id]: previous }))
      toast.error(apiErrorMessage(err, t("transferUpdateFailed")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="scheduled-transfers" className={cn("space-y-2", className)}>
      <h2 id="scheduled-transfers" className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
        {t("scheduledTransfers")}
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{rows.length}</span>
      </h2>
      <p className="text-xs text-muted-foreground">{t("transferScheduleHint")}</p>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {rows.map((tr) => {
          const fee = Number(tr.source_fee_amount || 0)
          const isBusy = busy === tr.id
          return (
            <li key={tr.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Clock className="size-4" aria-hidden />
              </span>
              {/* Phone: names, then the amounts, then a full-width action row.
                  From `sm:` the amounts and actions sit in a right-hand column.
                  Side by side at 375 px, a long amount pair plus the buttons left
                  the names 0 px wide and clipped the menu (MC-066). */}
              <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm font-medium">
                    <span className="truncate">{tr.source_account_name}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                    <span className="truncate">{tr.destination_account_name}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                    <span>{formatDateLabel(tr.transfer_date)}</span>
                    <Badge variant="outline" className={cn("py-0 text-[10px]", tr.status === "pending" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
                      {tr.status === "pending" ? t("statusPending") : t("statusPlanned")}
                    </Badge>
                    {tr.note && <span className="truncate">· {tr.note}</span>}
                  </p>
                  {isCrossCurrency(tr) && tr.effective_rate && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{formatRate(tr.source_currency, tr.destination_currency, tr.effective_rate)}</p>
                  )}
                </div>
                <div className="mt-1.5 flex flex-col gap-1 sm:mt-0 sm:max-w-[55%] sm:shrink-0 sm:items-end">
                  {/* Each amount stays whole; the pair wraps between them. */}
                  <p className="flex flex-wrap items-baseline gap-x-1 text-sm font-semibold tabular-nums sm:justify-end">
                    <span className="whitespace-nowrap">{formatMoney(Number(tr.source_amount), tr.source_currency, visible)}</span>
                    {isCrossCurrency(tr) && (
                      <>
                        <span className="text-muted-foreground" aria-hidden>→</span>
                        <span className="whitespace-nowrap">{formatMoney(Number(tr.destination_amount), tr.destination_currency, visible)}</span>
                      </>
                    )}
                  </p>
                  {fee > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">{t("feeShort", { amount: formatMoney(fee, tr.source_currency, visible) })}</p>}
                  {canWrite && (
                    <div className="mt-1 flex items-center gap-1">
                      {/* min-w-0 + wrapping: a long label (ml) must not push the
                          menu out of the clipped card (MC-T09). */}
                      <Button size="sm" variant="outline" className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal py-1.5 leading-tight sm:flex-none" disabled={isBusy} onClick={() => (isCrossCurrency(tr) ? setCompleting(tr) : transition(tr, "completed"))}>
                        <Check className="size-3.5" /> <span className="min-w-0 break-words">{t("markDone")}</span>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="size-11 shrink-0 text-muted-foreground" aria-label={t("transfer")} disabled={isBusy}>
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {tr.status === "planned" && (
                            <DropdownMenuItem className="min-h-11" onSelect={() => transition(tr, "pending")}><Clock className="size-4" /> {t("markPending")}</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setCancelling(tr)} className="min-h-11 text-destructive focus:text-destructive"><X className="size-4" /> {t("cancelTransfer")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <CompleteTransferDialog
        transfer={completing}
        onClose={() => setCompleting(null)}
        onConfirm={(tr, facts) => { setCompleting(null); void transition(tr, "completed", facts) }}
      />

      <AlertDialog open={cancelling !== null} onOpenChange={(o) => { if (!o) setCancelling(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelTransferTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelTransferDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("back")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const tr = cancelling; setCancelling(null); if (tr) void transition(tr, "cancelled") }}
            >
              {t("cancelTransfer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/**
 * Mark done for a cross-currency plan: what arrived is the bank's figure, not
 * the plan's, so it is asked for — prefilled from the plan, together with any
 * fee the bank took (MC-147). Validated with the server's own rules as typed.
 */
function CompleteTransferDialog({ transfer, onClose, onConfirm }: {
  transfer: Transfer | null
  onClose: () => void
  onConfirm: (tr: Transfer, facts: { destination_amount: string; source_fee_amount: string }) => void
}) {
  const { t } = useTranslation("wealth")
  const [received, setReceived] = useState("")
  const [fee, setFee] = useState("")
  // Prefill once per opening, from the plan.
  useEffect(() => {
    if (!transfer) return
    setReceived(String(Number(transfer.destination_amount)))
    setFee(Number(transfer.source_fee_amount || 0) > 0 ? String(Number(transfer.source_fee_amount)) : "")
  }, [transfer])

  let preview: ReturnType<typeof transferAmounts> | null = null
  let problem: AmountError | null = null
  if (transfer) {
    try {
      preview = transferAmounts({ sourceAmount: transfer.source_amount, destinationAmount: received, sourceFeeAmount: fee, sourceCurrency: transfer.source_currency, destinationCurrency: transfer.destination_currency })
    } catch (e) {
      if (e instanceof AmountError) problem = e
    }
  }
  const errorFor = (field: AmountField) => (problem?.field === field ? t(`apiErrors.${problem.code}`, { ns: "translation" }) : null)

  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("completeTransferTitle")}</DialogTitle>
          <DialogDescription>{t("completeTransferDesc")}</DialogDescription>
        </DialogHeader>
        {transfer && (
          <div className="space-y-3">
            <p className="text-sm font-medium tabular-nums">{formatMoney(Number(transfer.source_amount), transfer.source_currency)}</p>
            {/* The plan's own figure can't be edited here: a plan saved with
                ¥0.50 before whole units were enforced can only be cancelled
                and planned again — say why instead of a dead Mark done. */}
            {errorFor("source") && <p className="text-xs text-destructive">{errorFor("source")}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="complete-received">{t("transferReceivedAmount", { currency: transfer.destination_currency })}</Label>
              <Input id="complete-received" type="number" min="0" {...amountInputProps(transfer.destination_currency)} value={received} onChange={(e) => setReceived(e.target.value)} aria-invalid={!!errorFor("destination")} />
              {errorFor("destination") && <p className="text-xs text-destructive">{errorFor("destination")}</p>}
              {preview?.effectiveRate && <p className="text-xs text-muted-foreground tabular-nums">{formatRate(transfer.source_currency, transfer.destination_currency, preview.effectiveRate)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="complete-fee">{t("transferFeeAmount", { currency: transfer.source_currency })}</Label>
              <Input id="complete-fee" type="number" min="0" {...amountInputProps(transfer.source_currency)} value={fee} onChange={(e) => setFee(e.target.value)} aria-invalid={!!errorFor("fee")} />
              {errorFor("fee") && <p className="text-xs text-destructive">{errorFor("fee")}</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>{t("back")}</Button>
          <Button
            className="min-h-11 sm:min-h-9"
            disabled={!preview}
            onClick={() => { if (transfer && preview) onConfirm(transfer, { destination_amount: preview.destinationAmount, source_fee_amount: preview.sourceFeeAmount }) }}
          >
            <Check className="size-4" /> {t("markDone")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
