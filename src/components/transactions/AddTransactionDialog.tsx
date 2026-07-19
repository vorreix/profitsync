import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2, Paperclip, Sparkles, X } from "lucide-react"
import { apiDelete, apiErrorUpgradeHint, apiGet, apiPatch, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import { isPaidPlanKey, type Budget, type Client, type WealthAccount } from "@/lib/types"
import { tagLimitForPlan } from "@/lib/tags"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { useCategories } from "@/lib/use-categories"
import { loadLastTx, saveLastTx } from "@/lib/last-tx"
import { useModalDraft } from "@/hooks/use-modal-draft"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TxFormFields, type AiFieldMeta } from "@/components/transactions/tx-form"
import { AiCaptureView, type SmartApply } from "@/components/transactions/AiQuickFill"
import { useAiQuota } from "@/hooks/use-ai-quota"
import { mergeTags } from "@/lib/transaction-tags"
import {
  defaultAccountId,
  defaultTxForm,
  formatFileSize,
  uploadTxAttachment,
  type TxForm,
} from "@/components/transactions/tx-form-utils"

export type CreatedTxInfo = { id: string | null; type: "incoming" | "outgoing"; amount: number }

/**
 * THE single Add-Transaction modal, reused everywhere (the + FAB on any page and
 * the Transactions page itself) so the experience is identical. Self-contained:
 * loads accounts/clients/categories/budgets, manages the split form + attachments,
 * and creates via /api/transactions/group. Success feedback is the caller's job —
 * `onCreated` fires with the new transaction so the page can refresh in place or
 * the FAB can show a "View" toast.
 */
export function AddTransactionDialog({
  open,
  onOpenChange,
  onCreated,
  presetClientId,
  tagSuggestions,
  initialAi,
  onInitialAiConsumed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (info: CreatedTxInfo) => void
  presetClientId?: string
  tagSuggestions?: string[]
  // Handoff from the AI voice assistant: applied once (after accounts load so
  // the allocation can resolve) with the same highlights/undo as the in-modal
  // AI quick fill.
  initialAi?: SmartApply | null
  onInitialAiConsumed?: () => void
}) {
  const { t } = useTranslation("transactions")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  // Per-plan tag ceiling (free = 1, paid = 3). Clicking the premium chip closes
  // the form (draft is kept) and sends the user to upgrade.
  const tagLimit = tagLimitForPlan(isPaidPlanKey(activeOrg?.plan_key))
  const goUpgrade = () => { onOpenChange(false); navigate("/subscription") }
  const { categories: catRows, byType: categories, refresh: refreshCats } = useCategories()

  const [form, setForm] = useState<TxForm>(defaultTxForm)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [budgetMap, setBudgetMap] = useState<Map<string, Budget>>(new Map())
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // AI quick add: which fields the parser filled (drives highlights), plus the
  // pre-parse snapshot Undo restores. Cleared per-field on manual edits.
  const [aiMeta, setAiMeta] = useState<AiFieldMeta>({})
  const aiSnapshot = useRef<{ form: TxForm; files: File[] } | null>(null)
  // Progressive disclosure: the ONLY always-visible AI element is a sparkle
  // icon in the header; the capture surface replaces the form body on demand.
  const [aiOpen, setAiOpen] = useState(false)
  const { quota: aiQuota, consumeOne: aiConsume } = useAiQuota(open)
  // The dialog stays mounted across opens — don't reopen into the AI view.
  useEffect(() => { if (!open) setAiOpen(false) }, [open])

  // Voice-assistant handoff: stash it in a ref; the LOAD effect applies it
  // after seeding + account fetch (applying earlier let the open-effect's
  // form seeding clobber the AI values — the "said created but form was
  // empty" bug).
  const pendingAiRef = useRef<SmartApply | null>(null)
  useEffect(() => {
    if (!open || !initialAi) return
    pendingAiRef.current = initialAi
    onInitialAiConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAi])

  // A draft worth keeping: anything the user actually typed/attached.
  const dirty =
    form.description.trim() !== "" ||
    form.allocations.some((a) => a.amount !== "") ||
    pendingFiles.length > 0
  const draft = useModalDraft({ open, dirty, contextKey: presetClientId ?? "" })

  // Load data + seed the form each time the dialog opens (mirrors the page).
  useEffect(() => {
    if (!open) return
    // The dialog stays mounted between opens (AppLayout/FAB), so transient state
    // must be re-armed here or a previous run leaks into this one — a stale
    // `saving` left the Add button stuck on a spinner from the second open on.
    setSaving(false)
    // A dismissal (outside-click/Esc/Back) keeps the draft: skip re-seeding so
    // the user's typed data is exactly where they left it. Cancel/save cleared
    // the draft, so those re-seed fresh (sticky defaults + today's date).
    const seeding = draft.shouldSeed()
    if (seeding) {
      // Seed SYNCHRONOUSLY (sticky fields live in localStorage) so the form
      // never shows the previous run's values while the network loads — the old
      // async seed both flashed stale data and could clobber early typing.
      const last = loadLastTx()
      setForm({
        ...defaultTxForm(),
        client_id: presetClientId ?? last.client_id ?? "",
        type: last.type ?? "incoming",
        category: last.category ?? "",
        allocations: [],
      })
      setPendingFiles([])
    }
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const [accs, cls, bdg] = await Promise.all([
        apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        !isPersonal
          ? apiGet<Client[] | { data: Client[] }>("/api/clients", token).catch(() => [] as Client[])
          : Promise.resolve([] as Client[]),
        apiGet<{ budgets: Budget[] }>("/api/budgets", token).catch(() => ({ budgets: [] })),
      ])
      if (cancelled) return
      const active = (accs as WealthAccount[]).filter((a) => !a.archived_at)
      setAccounts(active)
      setAccountsLoading(false)
      const clientList = Array.isArray(cls) ? cls : (cls?.data ?? [])
      setClients(clientList)
      const m = new Map<string, Budget>()
      for (const b of bdg.budgets ?? []) m.set(b.client_id ?? "", b)
      setBudgetMap(m)
      if (seeding) {
        // Fill in only the remembered source account — and never clobber an
        // allocation the user already started while the request was in flight.
        const last = loadLastTx()
        const acctId =
          last.wealth_account_id && active.some((a) => a.id === last.wealth_account_id)
            ? last.wealth_account_id
            : defaultAccountId(active)
        setForm((prev) =>
          prev.allocations.length > 0 || !acctId ? prev : { ...prev, allocations: [{ account_id: acctId, amount: "" }] },
        )
      }
      // Voice-assistant handoff LAST — after seeding — so nothing overwrites it.
      if (pendingAiRef.current) {
        const handoff = pendingAiRef.current
        pendingAiRef.current = null
        applyAiResult(handoff, active)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Org-scoped category create/rename/delete from the picker (same diff logic as the page).
  const handleChangeCats = useCallback(
    async (type: "incoming" | "outgoing", names: string[]) => {
      const token = await getToken()
      if (!token) return
      const current = catRows.filter((c) => c.type === type)
      const currentNames = current.map((c) => c.name)
      const added = names.filter((n) => !currentNames.includes(n))
      const removed = currentNames.filter((n) => !names.includes(n))
      try {
        if (added.length === 1 && removed.length === 1 && names.length === currentNames.length) {
          const cat = current.find((c) => c.name === removed[0])
          if (cat) await apiPatch(`/api/categories/${cat.id}`, token, { name: added[0] })
        } else {
          for (const n of added) await apiPost("/api/categories", token, { name: n, type })
          for (const n of removed) {
            const cat = current.find((c) => c.name === n)
            if (cat) await apiDelete(`/api/categories/${cat.id}`, token)
          }
        }
        await refreshCats()
      } catch {
        toast.error(t("failedToUpdateCategories"))
      }
    },
    [getToken, catRows, refreshCats, t],
  )

  const budgetFor = (clientId: string): Budget | null =>
    (isPersonal ? budgetMap.get("") : clientId ? budgetMap.get(clientId) : undefined) ?? null

  // ── AI quick add ──────────────────────────────────────────────────────────
  const AI_KEY_FOR_PATCH: Record<string, keyof AiFieldMeta> = {
    client_id: "client", type: "type", allocations: "amount",
    description: "description", category: "category", date: "date",
  }

  // Manual edit of a field retires its AI highlight — the value is theirs now.
  function onFormChange(patch: Partial<TxForm>) {
    setForm((prev) => ({ ...prev, ...patch }))
    const touched = Object.keys(patch).map((k) => AI_KEY_FOR_PATCH[k]).filter(Boolean)
    if (touched.length) {
      setAiMeta((prev) => {
        const next = { ...prev }
        for (const k of touched) delete next[k]
        return next
      })
    }
  }

  function applyAiResult({ response, receiptFile, pickedClientId }: SmartApply, accountsOverride?: WealthAccount[]): void {
    const accts = accountsOverride ?? accounts
    const { confidence } = response
    // An explicit chip pick from the capture view overrides the match result.
    const fields = pickedClientId !== undefined
      ? { ...response.fields, client_id: pickedClientId }
      : response.fields
    if (pickedClientId) confidence.client = 1
    const HIGH = 0.85
    const FILL = 0.55
    const meta: AiFieldMeta = {}
    const patch: Partial<TxForm> = {}
    const check: string[] = []
    const label: Record<keyof AiFieldMeta, string> = {
      client: t("client"), type: t("type"), amount: t("amount"),
      description: t("description"), category: t("category"), date: t("date"),
    }

    const consider = (key: keyof AiFieldMeta, value: unknown, conf: number, apply: () => void) => {
      if (value == null || value === "") return
      if (conf < FILL) { check.push(label[key]); return } // abstain: too unsure to prefill
      apply()
      meta[key] = conf >= HIGH ? "high" : "medium"
      if (conf < HIGH) check.push(label[key])
    }

    consider("type", fields.type, confidence.type, () => { patch.type = fields.type })
    consider("amount", fields.amount, confidence.amount, () => {
      // "…from account A" — use the AI-matched wealth account when it's a real,
      // confidently-matched one; otherwise fall back to the usual default.
      const matchedAccount =
        fields.account_id && confidence.account >= FILL && accts.some((a) => a.id === fields.account_id)
          ? fields.account_id
          : defaultAccountId(accts)
      patch.allocations = [{ account_id: matchedAccount, amount: String(fields.amount) }]
    })
    consider("date", fields.date, confidence.date, () => { patch.date = fields.date! })
    // Description is free text the model rewrote — no numeric confidence; always "high".
    consider("description", fields.description, 1, () => { patch.description = fields.description! })
    consider("category", fields.category, confidence.category, () => { patch.category = fields.category! })
    if (!isPersonal && !presetClientId) {
      consider("client", fields.client_id, confidence.client, () => { patch.client_id = fields.client_id! })
    }

    // Snapshot INSIDE the updaters so Undo captures the true pre-apply state
    // even when this runs from an async callback with stale closures.
    setForm((prev) => {
      aiSnapshot.current = { form: prev, files: aiSnapshot.current?.files ?? pendingFiles }
      return { ...prev, ...patch }
    })
    setPendingFiles((prev) => {
      aiSnapshot.current = { form: aiSnapshot.current?.form ?? form, files: prev }
      return receiptFile ? [...prev, receiptFile] : prev
    })
    setAiMeta(meta)

    // Feedback lives OUTSIDE the modal chrome: one toast with Undo, plus the
    // transient field pulses. Nothing persistent is added to the form.
    const filled = Object.keys(meta).length + (receiptFile ? 1 : 0)
    toast.success(t("ai.filledSummary", { count: filled }), {
      description: check.length > 0 ? t("ai.checkFields", { fields: check.join(", ") }) : undefined,
      action: { label: t("ai.undo"), onClick: () => undoAiResult() },
    })
  }

  function undoAiResult() {
    const snap = aiSnapshot.current
    if (!snap) return
    setForm(snap.form)
    setPendingFiles(snap.files)
    setAiMeta({})
    aiSnapshot.current = null
  }

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const valid = files.filter((f) => {
      if (f.size > 2 * 1024 * 1024) { toast.error(t("fileExceeds2MBLimit", { name: f.name })); return false }
      return true
    })
    setPendingFiles((prev) => [...prev, ...valid])
    e.target.value = ""
  }

  async function handleAdd() {
    if (!isPersonal && !form.client_id) { toast.error(t("clientIsRequired")); return }
    const allocs = form.allocations.filter((a) => a.account_id && Number(a.amount) > 0)
    if (allocs.length === 0) { toast.error(t("validAmountIsRequired")); return }
    if (allocs.some((a) => amountExceedsLimit(a.amount))) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const result = await apiPost<{ group_id: string | null; ids: string[] }>("/api/transactions/group", token, {
        client_id: form.client_id,
        type: form.type,
        description: form.description,
        category: form.category,
        // Commit any un-entered draft too, so a typed-but-not-Entered tag isn't lost.
        tags: mergeTags(form.tags, form.tag_draft),
        date: form.date,
        allocations: allocs.map((a) => ({ wealth_account_id: a.account_id, amount: parseFloat(a.amount) })),
      })
      const firstId = result.ids[0] ?? null
      if (firstId) {
        for (const file of pendingFiles) {
          try { await uploadTxAttachment(file, firstId, token) }
          catch { toast.error(t("failedToUploadFile", { name: file.name })) }
        }
      }
      saveLastTx({ client_id: form.client_id, type: form.type, category: form.category, wealth_account_id: allocs[0]?.account_id })
      const total = allocs.reduce((s, a) => s + Number(a.amount), 0)
      draft.clearDraft()
      setPendingFiles([])
      setAiMeta({})
      aiSnapshot.current = null
      onOpenChange(false)
      onCreated?.({ id: firstId, type: form.type, amount: total })
    } catch (err) {
      // A tag/quota 402 → route to upgrade instead of a generic failure toast.
      if (apiErrorUpgradeHint(err)) { toast.info(t("tagsLimitReached")); goUpgrade(); return }
      toast.error(t("failedToAddTransaction"))
    } finally {
      // Always reset — the component stays mounted after a successful close, so a
      // missing reset here is what froze the button on the next open.
      setSaving(false)
    }
  }

  // Dismissals (outside-click/Esc/Back) keep the draft incl. attached files;
  // only Cancel and a successful add reset it (via clearDraft).
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1">{t("addTransaction")}</DialogTitle>
            {aiQuota?.enabled && !aiOpen && (
              <Button
                type="button" variant="ghost" size="icon"
                // Free plan wears the app's "premium feature" gold (same as the
                // bank-quota crown); paid plans get the normal primary tint.
                className={`-my-1 me-6 size-9 ${aiQuota.plan_key === "free" ? "text-amber-500 dark:text-amber-400" : "text-primary"}`}
                aria-label={t("ai.parse")}
                onClick={() => setAiOpen(true)}
              >
                <Sparkles className="size-5" />
              </Button>
            )}
          </div>
        </DialogHeader>
        {aiOpen && aiQuota ? (
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
            <AiCaptureView
              currency={currency}
              remaining={aiQuota.remaining}
              costs={aiQuota.costs}
              voice={aiQuota.voice}
              maxRecordSeconds={aiQuota.max_record_seconds}
              onApply={applyAiResult}
              onClose={() => setAiOpen(false)}
              onUpgrade={goUpgrade}
              onQuotaUsed={aiConsume}
            />
          </div>
        ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-1">
          <TxFormFields
            f={form}
            onChange={onFormChange}
            showClient={!isPersonal && !presetClientId}
            clients={clients}
            accounts={accounts}
            accountsLoading={accountsLoading}
            categories={categories}
            tagSuggestions={tagSuggestions}
            aiFields={aiMeta}
            tagLimit={tagLimit}
            onTagUpgrade={goUpgrade}
            onChangeCats={handleChangeCats}
            onAddAccount={() => { onOpenChange(false); navigate("/wealth") }}
            currency={currency}
            budget={budgetFor(form.client_id)}
          />
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Paperclip className="size-3.5" /> {t("attachments")}
                <span className="text-xs font-normal text-muted-foreground">({t("max2MBPerFile")})</span>
              </Label>
              <div>
                <input ref={fileRef} type="file" className="hidden" multiple onChange={onFileSelect} />
                <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}>{t("addFiles")}</Button>
              </div>
            </div>
            {pendingFiles.length > 0 && (
              <div className="space-y-1.5">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setPendingFiles((prev) => prev.filter((_, x) => x !== i))}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
        {!aiOpen && (
        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => { draft.clearDraft(); setPendingFiles([]); setAiMeta({}); aiSnapshot.current = null; onOpenChange(false) }}>{t("cancel")}</Button>
          <Button onClick={handleAdd} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : t("add")}</Button>
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
