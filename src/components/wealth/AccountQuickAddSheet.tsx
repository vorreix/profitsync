import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { z } from "zod"
import { toast } from "sonner"
import { useFieldErrors } from "@/lib/use-field-errors"
import { ArrowDownRight, ArrowUpRight, Paperclip, X } from "lucide-react"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { ACCEPT_ATTR, attachmentsListPath, uploadAttachment, validateFile } from "@/lib/attachments-client"
import type { Client, Transaction, WealthAccount } from "@/lib/types"
import { MAX_MONEY } from "@/lib/money"
import { accountDisplayName, currencySymbol } from "@/lib/wealth"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { CategoryPicker } from "@/components/CategoryPicker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const today = () => new Date().toISOString().split("T")[0]
const formatFileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Quick "add transaction" bottom-sheet scoped to ONE wealth account. Opened from
 * the account-detail page so the entry stays in place (no navigation): the
 * account is locked, it posts a single-leg group transaction, and `onSaved`
 * refreshes the list. Business orgs pick a client; personal orgs resolve the
 * hidden default client server-side.
 *
 * Pass `editTx` to reuse the same sheet for EDITING a single account leg: it
 * seeds the form from the transaction and PATCHes /api/transactions/:id (which
 * re-syncs the account balance) instead of creating a new one.
 */
export function AccountQuickAddSheet({
  account,
  open,
  onOpenChange,
  currency,
  isPersonal,
  onSaved,
  editTx = null,
}: {
  account: WealthAccount
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  isPersonal: boolean
  onSaved?: (firstId: string | null) => void
  editTx?: Transaction | null
}) {
  const { t } = useTranslation("transactions")
  const { getToken } = useAuth()
  const symbol = currencySymbol(currency)
  const isEdit = !!editTx

  const [type, setType] = useState<"incoming" | "outgoing">("outgoing")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [date, setDate] = useState(today())
  const [clientId, setClientId] = useState("")
  const [clients, setClients] = useState<Client[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const formSchema = z.object({
    amount: z.coerce.number().positive(t("validAmountIsRequired")).max(MAX_MONEY, t("common.amountTooLarge")),
    ...(isPersonal ? {} : { clientId: z.string().min(1, t("clientIsRequired")) }),
  })
  const { errors, validate, clearField, clearAll } = useFieldErrors(formSchema)

  // On open: seed from editTx when editing, else reset to a blank add form.
  useEffect(() => {
    if (!open) return
    if (editTx) {
      setType(editTx.type)
      setAmount(String(editTx.amount))
      setDescription(editTx.description ?? "")
      setCategory(editTx.category ?? "")
      setDate(editTx.date)
    } else {
      setType("outgoing")
      setAmount("")
      setDescription("")
      setCategory("")
      setDate(today())
    }
    setPendingFiles([])
    clearAll()
    // Re-arm: the sheet stays mounted between opens, so a request left in flight
    // when the user closed it must not freeze the save button on reopen.
    setSaving(false)
  }, [open, editTx, clearAll])

  // Business orgs need a client; load them lazily on open.
  useEffect(() => {
    if (!open || isPersonal) return
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      try {
        const res = await apiGet<{ data: Client[] } | Client[]>("/api/clients?page=1", token)
        const list = Array.isArray(res) ? res : res.data
        if (cancelled) return
        setClients(list)
        setClientId((prev) => prev || list.find((c) => c.is_own)?.id || list[0]?.id || "")
      } catch {
        /* leave empty — validation will prompt for a client */
      }
    })()
    return () => { cancelled = true }
  }, [open, isPersonal, getToken])

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files || [])
    if (fileRef.current) fileRef.current.value = ""
    const valid: File[] = []
    for (const file of files) {
      const err = validateFile(file)
      if (err) { toast.error(err); continue }
      valid.push(file)
    }
    setPendingFiles((p) => [...p, ...valid])
  }

  async function save() {
    // Red-border validation (zod). Required/invalid fields turn red in place.
    if (!validate({ amount, clientId })) return
    const amt = parseFloat(amount)
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      let firstId: string | null
      if (editTx) {
        // Edit a single account leg: PATCH re-syncs this account's balance.
        await apiPatch<Transaction>(`/api/transactions/${editTx.id}`, token, {
          type,
          amount: amt,
          description,
          category,
          date,
        })
        firstId = editTx.id
      } else {
        const result = await apiPost<{ group_id: string | null; ids: string[]; legs: Transaction[] }>(
          "/api/transactions/group",
          token,
          {
            ...(isPersonal ? {} : { client_id: clientId }),
            type,
            description,
            category,
            date,
            allocations: [{ wealth_account_id: account.id, amount: amt }],
          },
        )
        firstId = result.ids[0] ?? null
      }
      if (firstId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          try {
            await uploadAttachment(attachmentsListPath("transaction", firstId), file, token)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : `Failed to attach ${file.name}`)
          }
        }
      }
      toast.success(isEdit ? t("transactionUpdated") : t("transactionAdded"))
      onOpenChange(false)
      onSaved?.(firstId)
    } catch {
      toast.error(isEdit ? t("failedToUpdateTransaction") : t("failedToAddTransaction"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <WealthAccountIcon account={account} className="size-7" />
            <span className="truncate">{isEdit ? t("editTransaction") : accountDisplayName(account)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          {/* Type */}
          <div className="space-y-1.5">
            <Label>{t("type")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["incoming", "outgoing"] as const).map((ty) => (
                <button
                  key={ty}
                  type="button"
                  onClick={() => { setType(ty); setCategory("") }}
                  className={`flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors ${
                    type === ty
                      ? ty === "incoming"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "border-red-500 bg-red-50 text-red-700 dark:border-red-600 dark:bg-red-900/20 dark:text-red-400"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {ty === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  {t(ty)}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="qa-amount">{t("amount")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">{symbol}</span>
              <Input
                id="qa-amount"
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); clearField("amount") }}
                placeholder="0.00"
                aria-invalid={!!errors.amount}
                className="h-12 pl-9 text-lg font-semibold tabular-nums"
                autoFocus
              />
            </div>
            {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
          </div>

          {/* Client (business only; not changeable while editing a leg) */}
          {!isPersonal && !isEdit && (
            <div className="space-y-1.5">
              <Label>{t("clientRequired")}</Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); clearField("clientId") }}>
                <SelectTrigger className="w-full" aria-invalid={!!errors.clientId}><SelectValue placeholder={t("client")} /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.clientId && <p className="text-xs text-destructive">{errors.clientId}</p>}
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="qa-desc">{t("description")}</Label>
            <Textarea
              id="qa-desc"
              rows={2}
              className="resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={type === "incoming" ? t("invoicePlaceholder") : t("hostingFeePlaceholder")}
            />
          </div>

          {/* Category + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("category")}</Label>
              <CategoryPicker type={type} value={category} onChange={setCategory} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-date">{t("date")}</Label>
              <Input id="qa-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Paperclip className="size-3.5" /> {t("attachments")}
                <span className="text-xs font-normal text-muted-foreground">({t("max2MBPerFile")})</span>
              </Label>
              <div>
                <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={onPickFiles} />
                <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}>{t("addFiles")}</Button>
              </div>
            </div>
            {pendingFiles.length > 0 && (
              <div className="space-y-1.5">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("cancel")}</Button>
          <Button onClick={save} disabled={saving}>
            {isEdit ? (saving ? t("saving") : t("save")) : saving ? t("adding") : t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
