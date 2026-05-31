import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader as Loader2, Save, Sparkles, Plus, CreditCard } from "lucide-react"

type Plan = {
  id: string
  key: string
  name: string
  account_type: string | null
  is_active: boolean
  monthly_price_usd: string
  yearly_price_usd: string
  monthly_discount_pct: number
  yearly_discount_pct: number
  dodo_product_monthly: string | null
  dodo_product_yearly: string | null
  limits: Record<string, number>
  geo_pricing: Record<string, { currency: string; monthly: number; yearly: number; monthlyDiscountPct?: number; yearlyDiscountPct?: number }>
  created_at: string
  updated_at: string
  _warnings?: string[]
}

const LIMIT_FIELDS: Array<{ key: keyof Plan["limits"]; label: string; suffix?: string }> = [
  { key: "clients", label: "Clients" },
  { key: "transactionsPerClient", label: "Transactions / client" },
  { key: "quotations", label: "Quotations" },
  { key: "attachmentSizeKb", label: "Attachment size", suffix: "KB" },
  { key: "attachmentsPerTx", label: "Attachments / transaction" },
  { key: "noteLength", label: "Note length", suffix: "chars" },
]

const ACCOUNT_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
]

function AccountTypeSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {ACCOUNT_TYPE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

const emptyNewPlan = {
  key: "",
  name: "",
  account_type: "" as string,
  dodo_product_monthly: "",
  dodo_product_yearly: "",
}

export function AdminPlansPage() {
  const { getToken } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [derivingId, setDerivingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Plan>>({})
  const [newPlan, setNewPlan] = useState({ ...emptyNewPlan })
  const [creating, setCreating] = useState(false)

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

  const updateDraft = (id: string, patch: Partial<Plan>) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  const updateLimit = (id: string, key: string, value: number) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], limits: { ...d[id].limits, [key]: value } } }))
  }

  const updateGeo = (id: string, country: string, patch: Partial<Plan["geo_pricing"][string]>) => {
    setDrafts((d) => {
      const existing = d[id].geo_pricing[country] ?? { currency: "USD", monthly: 0, yearly: 0 }
      return {
        ...d,
        [id]: { ...d[id], geo_pricing: { ...d[id].geo_pricing, [country]: { ...existing, ...patch } } },
      }
    })
  }

  const planPayload = (draft: Plan, derive: boolean) => ({
    plan_id: draft.id,
    name: draft.name,
    account_type: draft.account_type,
    is_active: draft.is_active,
    monthly_price_usd: draft.monthly_price_usd,
    yearly_price_usd: draft.yearly_price_usd,
    monthly_discount_pct: draft.monthly_discount_pct,
    yearly_discount_pct: draft.yearly_discount_pct,
    dodo_product_monthly: draft.dodo_product_monthly || null,
    dodo_product_yearly: draft.dodo_product_yearly || null,
    limits: draft.limits,
    geo_pricing: draft.geo_pricing,
    derive,
  })

  const applyUpdated = (id: string, updated: Plan) => {
    setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)))
    setDrafts((d) => ({ ...d, [id]: updated }))
    if (updated._warnings?.length) {
      for (const w of updated._warnings) toast.warning(w)
    }
  }

  const handleSave = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    setSavingId(id)
    try {
      const token = await getToken()
      if (!token) return
      const updated = await apiPatch<Plan>("/api/admin/plans", token, planPayload(draft, false))
      applyUpdated(id, updated)
      toast.success(`Plan "${updated.name}" saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSavingId(null)
    }
  }

  // Pull name/price from the entered Dodo product IDs.
  const handleDerive = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    if (!draft.dodo_product_monthly && !draft.dodo_product_yearly) {
      toast.error("Enter at least one Dodo product ID first")
      return
    }
    setDerivingId(id)
    try {
      const token = await getToken()
      if (!token) return
      const updated = await apiPatch<Plan>("/api/admin/plans", token, planPayload(draft, true))
      applyUpdated(id, updated)
      toast.success(`Synced "${updated.name}" from Dodo`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setDerivingId(null)
    }
  }

  const handleCreate = async () => {
    if (!newPlan.key.trim()) { toast.error("Plan key is required"); return }
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) return
      const created = await apiPost<Plan>("/api/admin/plans", token, {
        key: newPlan.key.trim().toLowerCase(),
        name: newPlan.name.trim() || newPlan.key.trim(),
        account_type: newPlan.account_type || null,
        dodo_product_monthly: newPlan.dodo_product_monthly.trim() || null,
        dodo_product_yearly: newPlan.dodo_product_yearly.trim() || null,
        derive: true,
      })
      setPlans((prev) => [...prev, created].sort((a, b) => a.key.localeCompare(b.key)))
      setDrafts((d) => ({ ...d, [created.id]: created }))
      setNewPlan({ ...emptyNewPlan })
      if (created._warnings?.length) for (const w of created._warnings) toast.warning(w)
      toast.success(`Plan "${created.name}" created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create plan")
    } finally {
      setCreating(false)
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Personal &amp; Business plans are driven by Dodo Payments product IDs. Enter a product ID per billing
          cycle and use <span className="font-medium">Derive from Dodo</span> to pull the name and price.
        </p>
      </div>

      {/* Create new plan */}
      <Card className="p-5 space-y-4 border-dashed">
        <div className="flex items-center gap-2">
          <Plus className="size-4" />
          <h2 className="font-semibold">Add a plan</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Key</Label>
            <Input placeholder="personal" value={newPlan.key} onChange={(e) => setNewPlan((p) => ({ ...p, key: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input placeholder="Personal Starter" value={newPlan.name} onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account type</Label>
            <AccountTypeSelect value={newPlan.account_type} onChange={(v) => setNewPlan((p) => ({ ...p, account_type: v ?? "" }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Dodo product (Monthly)</Label>
            <Input placeholder="pdt_…" value={newPlan.dodo_product_monthly} onChange={(e) => setNewPlan((p) => ({ ...p, dodo_product_monthly: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Dodo product (Yearly)</Label>
            <Input placeholder="pdt_…" value={newPlan.dodo_product_yearly} onChange={(e) => setNewPlan((p) => ({ ...p, dodo_product_yearly: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Plus className="size-3.5 mr-1.5" />}
            Create plan
          </Button>
        </div>
      </Card>

      {plans.map((p) => {
        const draft = drafts[p.id]
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
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={draft.is_active} onCheckedChange={(v) => updateDraft(p.id, { is_active: v })} />
                  <span className="text-xs text-muted-foreground">{draft.is_active ? "Active" : "Disabled"}</span>
                </div>
              </div>
              <Button onClick={() => handleSave(p.id)} disabled={savingId === p.id}>
                {savingId === p.id ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Save className="size-3.5 mr-1.5" />}
                Save
              </Button>
            </div>

            {/* Dodo product configuration — the source of truth for checkout. */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <CreditCard className="size-3.5" /> Dodo Payments
                </p>
                <Button variant="outline" size="sm" onClick={() => handleDerive(p.id)} disabled={derivingId === p.id}>
                  {derivingId === p.id ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
                  Derive from Dodo
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Account type</Label>
                  <AccountTypeSelect value={draft.account_type} onChange={(v) => updateDraft(p.id, { account_type: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Product ID (Monthly)</Label>
                  <Input
                    placeholder="pdt_…"
                    value={draft.dodo_product_monthly ?? ""}
                    onChange={(e) => updateDraft(p.id, { dodo_product_monthly: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Product ID (Yearly)</Label>
                  <Input
                    placeholder="pdt_…"
                    value={draft.dodo_product_yearly ?? ""}
                    onChange={(e) => updateDraft(p.id, { dodo_product_yearly: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly (USD)</Label>
                <Input value={draft.monthly_price_usd} onChange={(e) => updateDraft(p.id, { monthly_price_usd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Yearly (USD)</Label>
                <Input value={draft.yearly_price_usd} onChange={(e) => updateDraft(p.id, { yearly_price_usd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly discount %</Label>
                <Input type="number" value={draft.monthly_discount_pct} onChange={(e) => updateDraft(p.id, { monthly_discount_pct: parseInt(e.target.value || "0", 10) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Yearly discount %</Label>
                <Input type="number" value={draft.yearly_discount_pct} onChange={(e) => updateDraft(p.id, { yearly_discount_pct: parseInt(e.target.value || "0", 10) })} />
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Limits</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {LIMIT_FIELDS.map(({ key, label, suffix }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs">{label}</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        value={draft.limits?.[key] ?? 0}
                        onChange={(e) => updateLimit(p.id, key as string, parseInt(e.target.value || "0", 10))}
                      />
                      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
                    </div>
                  </div>
                ))}
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
                    if (draft.geo_pricing[code]) {
                      toast.error(`${code} already exists`)
                      return
                    }
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
