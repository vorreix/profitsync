import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import {
  Loader as Loader2,
  Save,
  Sparkles,
  CreditCard,
  ArrowLeft,
  ArrowRight,
  User,
  Building2,
  Wand2,
  Check,
  Trash2,
  Database,
} from "lucide-react"

type AccountType = "personal" | "business"

type CycleInfo = {
  product_id: string
  name: string
  description: string
  price_usd: string
  discount_pct: number
  discounted_usd: string
  interval: "monthly" | "yearly" | null
  trial_days: number
  recurring: boolean
  currency: string
  image: string | null
  tax_category: string | null
  metadata: Record<string, string>
}

type Plan = {
  id: string
  key: string
  name: string
  description: string
  account_type: string | null
  is_active: boolean
  monthly_price_usd: string
  yearly_price_usd: string
  monthly_discount_pct: number
  yearly_discount_pct: number
  dodo_product_monthly: string | null
  dodo_product_yearly: string | null
  limits: Record<string, number>
  feature_labels: Record<string, string>
  dodo_metadata: { monthly?: CycleInfo; yearly?: CycleInfo }
  geo_pricing: Record<string, { currency: string; monthly: number; yearly: number; monthlyDiscountPct?: number; yearlyDiscountPct?: number }>
  created_at: string
  updated_at: string
  _warnings?: string[]
}

type Preview = {
  name?: string
  description?: string
  currency: string
  monthly: CycleInfo | null
  yearly: CycleInfo | null
  dodo_metadata: { monthly?: CycleInfo; yearly?: CycleInfo }
  warnings: string[]
}

const LIMIT_FIELDS: Array<{ key: keyof Plan["limits"]; label: string; suffix?: string }> = [
  { key: "clients", label: "Clients" },
  { key: "transactionsPerClient", label: "Transactions / client" },
  { key: "quotations", label: "Quotations" },
  { key: "attachmentSizeKb", label: "Attachment size", suffix: "KB" },
  { key: "attachmentsPerTx", label: "Attachments / transaction" },
  { key: "noteLength", label: "Note length", suffix: "chars" },
]

const ACCOUNT_TYPE_META: Record<AccountType, { label: string; icon: typeof User; blurb: string }> = {
  personal: { label: "Personal", icon: User, blurb: "Solo finance tracking" },
  business: { label: "Business", icon: Building2, blurb: "Clients, quotations & team" },
}

// Rounds the discounted cents like Dodo does, so this matches what Dodo charges.
function discountedUsd(priceUsd: string, pct: number): string {
  const minor = Math.round(parseFloat(priceUsd || "0") * 100)
  return (Math.round(minor * (1 - pct / 100)) / 100).toFixed(2)
}

function money(usd: string, currency: string): string {
  const n = parseFloat(usd || "0")
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

/** Placeholder hints for the per-limit display strings. */
const FEATURE_HINTS: Record<string, string> = {
  clients: 'e.g. "Unlimited clients"',
  transactionsPerClient: 'e.g. "Unlimited transactions"',
  quotations: 'e.g. "Unlimited quotations"',
  attachmentSizeKb: 'e.g. "Up to 10 MB attachments"',
  attachmentsPerTx: 'e.g. "10 files per item"',
  noteLength: 'e.g. "Long notes"',
}
const featureHint = (key: string) => FEATURE_HINTS[key] ?? "Shown on the plan card"

/** Read-only panel showing everything synced from Dodo (per billing cycle). */
function DodoSyncedPanel({ data }: { data: Plan["dodo_metadata"] }) {
  const cycles = (["monthly", "yearly"] as const).filter((c) => data?.[c])
  if (cycles.length === 0) return null
  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <p className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
        <Database className="size-3.5" /> Synced from Dodo
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cycles.map((c) => {
          const info = data[c]!
          return (
            <div key={c} className="rounded-md border bg-background p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                {info.image && <img src={info.image} alt="" className="size-9 rounded object-cover border shrink-0" />}
                <div className="min-w-0">
                  <p className="font-medium truncate">{info.name || "—"}</p>
                  <p className="text-muted-foreground capitalize">{c} · {info.product_id.slice(0, 14)}…</p>
                </div>
              </div>
              {info.description && <p className="text-muted-foreground">{info.description}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                <span>List {money(info.price_usd, info.currency)}</span>
                <span>{info.discount_pct}% off</span>
                <span>→ {money(info.discounted_usd, info.currency)}</span>
                {info.tax_category && <span>tax: {info.tax_category}</span>}
                {info.trial_days > 0 && <span>{info.trial_days}d trial</span>}
              </div>
              {Object.keys(info.metadata ?? {}).length > 0 && (
                <div className="pt-1.5 border-t">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Metadata</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(info.metadata).map(([k, v]) => (
                      <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        <span className="text-muted-foreground">{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sync-from-Dodo wizard ────────────────────────────────────────────────────

type WizardForm = {
  name: string
  description: string
  monthlyPrice: string
  monthlyDiscount: number
  yearlyPrice: string
  yearlyDiscount: number
}

function SyncWizard({
  open,
  onOpenChange,
  existingPlans,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  existingPlans: Plan[]
  onSaved: (plan: Plan) => void
}) {
  const { getToken } = useAuth()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  const [monthlyId, setMonthlyId] = useState("")
  const [yearlyId, setYearlyId] = useState("")
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [form, setForm] = useState<WizardForm>({
    name: "", description: "", monthlyPrice: "0", monthlyDiscount: 0, yearlyPrice: "0", yearlyDiscount: 0,
  })

  const reset = () => {
    setStep(1); setAccountType(null); setMonthlyId(""); setYearlyId("")
    setPreview(null); setSyncing(false); setSaving(false)
    setForm({ name: "", description: "", monthlyPrice: "0", monthlyDiscount: 0, yearlyPrice: "0", yearlyDiscount: 0 })
  }

  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o) }

  const handleSync = async () => {
    if (!monthlyId.trim() && !yearlyId.trim()) { toast.error("Paste at least one Dodo product ID"); return }
    setSyncing(true)
    try {
      const token = await getToken()
      if (!token) return
      const p = await apiPost<Preview>("/api/admin/plans", token, {
        preview: true,
        dodo_product_monthly: monthlyId.trim() || null,
        dodo_product_yearly: yearlyId.trim() || null,
      })
      setPreview(p)
      setForm({
        name: p.name ?? ACCOUNT_TYPE_META[accountType ?? "personal"].label + " Plan",
        description: p.description ?? "",
        monthlyPrice: p.monthly?.price_usd ?? "0",
        monthlyDiscount: p.monthly?.discount_pct ?? 0,
        yearlyPrice: p.yearly?.price_usd ?? "0",
        yearlyDiscount: p.yearly?.discount_pct ?? 0,
      })
      if (p.warnings?.length) for (const w of p.warnings) toast.warning(w)
      setStep(3)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  const handleSave = async () => {
    if (!accountType) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const payload = {
        name: form.name.trim(),
        description: form.description,
        account_type: accountType,
        monthly_price_usd: form.monthlyPrice,
        monthly_discount_pct: form.monthlyDiscount,
        yearly_price_usd: form.yearlyPrice,
        yearly_discount_pct: form.yearlyDiscount,
        dodo_product_monthly: monthlyId.trim() || null,
        dodo_product_yearly: yearlyId.trim() || null,
        dodo_metadata: preview?.dodo_metadata ?? {},
      }
      // Upsert the plan that serves this account type (key === account type).
      const existing = existingPlans.find((p) => p.account_type === accountType || p.key === accountType)
      const saved = existing
        ? await apiPatch<Plan>("/api/admin/plans", token, { plan_id: existing.id, ...payload })
        : await apiPost<Plan>("/api/admin/plans", token, { key: accountType, ...payload })
      onSaved(saved)
      toast.success(`Plan "${saved.name}" synced & saved`)
      close(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const currency = preview?.currency ?? "USD"

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" /> Sync a plan from Dodo
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <span className={`flex size-6 items-center justify-center rounded-full border text-[11px] font-medium ${
                step >= s ? "bg-primary text-primary-foreground border-transparent" : "text-muted-foreground"
              }`}>
                {step > s ? <Check className="size-3.5" /> : s}
              </span>
              <span className={step >= s ? "font-medium" : "text-muted-foreground"}>
                {s === 1 ? "Account type" : s === 2 ? "Product IDs" : "Review & save"}
              </span>
              {s < 3 && <span className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Which account type is this plan for?</p>
            <div className="grid grid-cols-2 gap-3">
              {(["personal", "business"] as AccountType[]).map((type) => {
                const meta = ACCOUNT_TYPE_META[type]
                const Icon = meta.icon
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAccountType(type)}
                    className={`rounded-xl border p-4 text-left transition-all ${
                      accountType === type ? "border-primary ring-2 ring-primary/40" : "hover:border-foreground/30"
                    }`}
                  >
                    <Icon className="size-5" />
                    <p className="mt-2 font-medium">{meta.label}</p>
                    <p className="text-xs text-muted-foreground">{meta.blurb}</p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Paste the Dodo product IDs for the <span className="font-medium">{accountType}</span> plan. We'll pull the
              name, description, prices and discounts automatically.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Monthly product ID</Label>
              <Input placeholder="pdt_…" value={monthlyId} onChange={(e) => setMonthlyId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Yearly product ID</Label>
              <Input placeholder="pdt_…" value={yearlyId} onChange={(e) => setYearlyId(e.target.value)} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-2 max-h-[55vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Plan name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="resize-none"
              />
            </div>

            {(["monthly", "yearly"] as const).map((cycle) => {
              const info = cycle === "monthly" ? preview?.monthly : preview?.yearly
              const price = cycle === "monthly" ? form.monthlyPrice : form.yearlyPrice
              const discount = cycle === "monthly" ? form.monthlyDiscount : form.yearlyDiscount
              const setPrice = (v: string) => setForm((f) => ({ ...f, [cycle === "monthly" ? "monthlyPrice" : "yearlyPrice"]: v }))
              const setDiscount = (v: number) => setForm((f) => ({ ...f, [cycle === "monthly" ? "monthlyDiscount" : "yearlyDiscount"]: v }))
              return (
                <div key={cycle} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground capitalize">{cycle}</p>
                    {info ? (
                      <span className="text-[11px] text-muted-foreground">
                        from Dodo: {info.product_id.slice(0, 12)}…{info.trial_days ? ` · ${info.trial_days}d trial` : ""}
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">not provided</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Price ({currency})</Label>
                      <Input value={price} onChange={(e) => setPrice(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Discount %</Label>
                      <Input
                        type="number"
                        value={discount}
                        onChange={(e) => setDiscount(parseInt(e.target.value || "0", 10))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">After discount</Label>
                      <div className="h-9 flex items-center rounded-md border bg-muted/40 px-3 text-sm font-medium tabular-nums">
                        {money(discountedUsd(price, discount), currency)}
                        <span className="ml-1 text-xs text-muted-foreground">/{cycle === "monthly" ? "mo" : "yr"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {preview?.warnings?.length ? (
              <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
                {preview.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} disabled={syncing || saving}>
              <ArrowLeft className="size-4 mr-1" /> Back
            </Button>
          )}
          {step === 1 && (
            <Button className="ml-auto" disabled={!accountType} onClick={() => setStep(2)}>
              Continue <ArrowRight className="size-4 ml-1" />
            </Button>
          )}
          {step === 2 && (
            <Button className="ml-auto" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Sparkles className="size-4 mr-1.5" />}
              Sync from Dodo
            </Button>
          )}
          {step === 3 && (
            <Button className="ml-auto" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
              Save plan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminPlansPage() {
  const { getToken } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Plan>>({})
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deletePlan, setDeletePlan] = useState<Plan | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<Plan[]>("/api/admin/plans", token)
      setPlans(data)
      const map: Record<string, Plan> = {}
      for (const p of data) map[p.id] = p
      setDrafts(map)
    } catch {
      toast.error("Failed to load plans")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken])

  const upsertLocal = (saved: Plan) => {
    setPlans((prev) => {
      const next = prev.some((p) => p.id === saved.id)
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [...prev, saved]
      return next.sort((a, b) => a.key.localeCompare(b.key))
    })
    setDrafts((d) => ({ ...d, [saved.id]: saved }))
  }

  const updateDraft = (id: string, patch: Partial<Plan>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))
  const updateLimit = (id: string, key: string, value: number) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], limits: { ...d[id].limits, [key]: value } } }))
  const updateFeatureLabel = (id: string, key: string, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], feature_labels: { ...d[id].feature_labels, [key]: value } } }))
  const updateGeo = (id: string, country: string, patch: Partial<Plan["geo_pricing"][string]>) =>
    setDrafts((d) => {
      const existing = d[id].geo_pricing[country] ?? { currency: "USD", monthly: 0, yearly: 0 }
      return { ...d, [id]: { ...d[id], geo_pricing: { ...d[id].geo_pricing, [country]: { ...existing, ...patch } } } }
    })

  const handleSave = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    setSavingId(id)
    try {
      const token = await getToken()
      if (!token) return
      const updated = await apiPatch<Plan>("/api/admin/plans", token, {
        plan_id: id,
        name: draft.name,
        description: draft.description,
        account_type: draft.account_type,
        is_active: draft.is_active,
        monthly_price_usd: draft.monthly_price_usd,
        yearly_price_usd: draft.yearly_price_usd,
        monthly_discount_pct: draft.monthly_discount_pct,
        yearly_discount_pct: draft.yearly_discount_pct,
        dodo_product_monthly: draft.dodo_product_monthly || null,
        dodo_product_yearly: draft.dodo_product_yearly || null,
        limits: draft.limits,
        feature_labels: draft.feature_labels,
        geo_pricing: draft.geo_pricing,
      })
      upsertLocal(updated)
      toast.success(`Plan "${updated.name}" saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deletePlan) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/plans", token, { plan_id: deletePlan.id })
      setPlans((prev) => prev.filter((p) => p.id !== deletePlan.id))
      setDrafts((d) => {
        const next = { ...d }
        delete next[deletePlan.id]
        return next
      })
      toast.success(`Plan "${deletePlan.name}" deleted`)
      setDeletePlan(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Personal &amp; Business plans are driven by Dodo Payments product IDs. Use the wizard to paste a product ID
            and sync the name, description, prices and discounts in one step.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Wand2 className="size-4 mr-1.5" /> Sync from Dodo
        </Button>
      </div>

      <SyncWizard open={wizardOpen} onOpenChange={setWizardOpen} existingPlans={plans} onSaved={upsertLocal} />

      <AlertDialog open={!!deletePlan} onOpenChange={(o) => { if (!o) setDeletePlan(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deletePlan?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the plan from ProfitSync only — the Dodo product is{" "}
              <span className="font-medium">not</span> deleted in Dodo. Any customers currently on this plan keep
              their subscription, but it can no longer be offered to new ones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete() }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Trash2 className="size-3.5 mr-1.5" />}
              Delete plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {plans.map((p) => {
        const draft = drafts[p.id]
        if (!draft) return null
        const mDisc = discountedUsd(draft.monthly_price_usd, draft.monthly_discount_pct)
        const yDisc = discountedUsd(draft.yearly_price_usd, draft.yearly_discount_pct)
        return (
          <Card key={p.id} className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 space-y-1 min-w-[220px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    value={draft.name}
                    onChange={(e) => updateDraft(p.id, { name: e.target.value })}
                    className="text-lg font-semibold max-w-xs"
                  />
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">{p.key}</span>
                  {draft.account_type && <Badge variant="outline" className="capitalize">{draft.account_type}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={draft.is_active} onCheckedChange={(v) => updateDraft(p.id, { is_active: v })} />
                  <span className="text-xs text-muted-foreground">{draft.is_active ? "Active" : "Disabled"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => handleSave(p.id)} disabled={savingId === p.id}>
                  {savingId === p.id ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Save className="size-3.5 mr-1.5" />}
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeletePlan(p)}
                  title="Delete plan"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={2}
                value={draft.description ?? ""}
                onChange={(e) => updateDraft(p.id, { description: e.target.value })}
                className="resize-none"
              />
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="size-3.5" /> Dodo product IDs
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Monthly</Label>
                  <Input value={draft.dodo_product_monthly ?? ""} onChange={(e) => updateDraft(p.id, { dodo_product_monthly: e.target.value })} placeholder="pdt_…" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Yearly</Label>
                  <Input value={draft.dodo_product_yearly ?? ""} onChange={(e) => updateDraft(p.id, { dodo_product_yearly: e.target.value })} placeholder="pdt_…" />
                </div>
              </div>
            </div>

            <DodoSyncedPanel data={draft.dodo_metadata} />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly (USD)</Label>
                <Input value={draft.monthly_price_usd} onChange={(e) => updateDraft(p.id, { monthly_price_usd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly discount %</Label>
                <Input type="number" value={draft.monthly_discount_pct} onChange={(e) => updateDraft(p.id, { monthly_discount_pct: parseInt(e.target.value || "0", 10) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Yearly (USD)</Label>
                <Input value={draft.yearly_price_usd} onChange={(e) => updateDraft(p.id, { yearly_price_usd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Yearly discount %</Label>
                <Input type="number" value={draft.yearly_discount_pct} onChange={(e) => updateDraft(p.id, { yearly_discount_pct: parseInt(e.target.value || "0", 10) })} />
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Monthly after discount: <span className="font-medium text-foreground">${mDisc}/mo</span></span>
              <span>Yearly after discount: <span className="font-medium text-foreground">${yDisc}/yr</span></span>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Limits &amp; feature labels</p>
                <p className="text-[11px] text-muted-foreground">
                  Number = the real limit enforced by quota · Text = what's shown in this plan's feature list
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {LIMIT_FIELDS.map(({ key, label, suffix }) => {
                  const k = key as string
                  return (
                    <div key={key} className="rounded-md border p-3 space-y-2">
                      <Label className="text-xs">{label}</Label>
                      <div className="flex gap-2">
                        <div className="relative w-28 shrink-0">
                          <Input
                            type="number"
                            value={draft.limits?.[key] ?? 0}
                            onChange={(e) => updateLimit(p.id, k, parseInt(e.target.value || "0", 10))}
                          />
                          {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
                        </div>
                        <Input
                          value={draft.feature_labels?.[k] ?? ""}
                          onChange={(e) => updateFeatureLabel(p.id, k, e.target.value)}
                          placeholder={featureHint(k)}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Geo pricing</p>
              <div className="space-y-2">
                {Object.entries(draft.geo_pricing).map(([country, cfg]) => (
                  <div key={country} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end border border-border rounded-md p-3">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Country</Label>
                      <Input value={country} disabled />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Currency</Label>
                      <Input value={cfg.currency} onChange={(e) => updateGeo(p.id, country, { currency: e.target.value.toUpperCase() })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Monthly (minor)</Label>
                      <Input type="number" value={cfg.monthly} onChange={(e) => updateGeo(p.id, country, { monthly: parseInt(e.target.value || "0", 10) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Yearly (minor)</Label>
                      <Input type="number" value={cfg.yearly} onChange={(e) => updateGeo(p.id, country, { yearly: parseInt(e.target.value || "0", 10) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Monthly disc%</Label>
                      <Input type="number" value={cfg.monthlyDiscountPct ?? 0} onChange={(e) => updateGeo(p.id, country, { monthlyDiscountPct: parseInt(e.target.value || "0", 10) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Yearly disc%</Label>
                      <Input type="number" value={cfg.yearlyDiscountPct ?? 0} onChange={(e) => updateGeo(p.id, country, { yearlyDiscountPct: parseInt(e.target.value || "0", 10) })} />
                    </div>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const code = window.prompt("Country code (ISO 3166-1 alpha-2, e.g. US, IN, GB)")?.toUpperCase()
                    if (!code) return
                    if (draft.geo_pricing[code]) { toast.error(`${code} already exists`); return }
                    updateGeo(p.id, code, { currency: "USD", monthly: 0, yearly: 0 })
                  }}
                >
                  Add country
                </Button>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
