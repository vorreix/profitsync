import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPatch } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader as Loader2, Save } from "lucide-react"

type Plan = {
  id: string
  key: string
  name: string
  is_active: boolean
  monthly_price_usd: string
  yearly_price_usd: string
  monthly_discount_pct: number
  yearly_discount_pct: number
  limits: Record<string, number>
  geo_pricing: Record<string, { currency: string; monthly: number; yearly: number; monthlyDiscountPct?: number; yearlyDiscountPct?: number }>
  created_at: string
  updated_at: string
}

const LIMIT_FIELDS: Array<{ key: keyof Plan["limits"]; label: string; suffix?: string }> = [
  { key: "clients", label: "Clients" },
  { key: "transactionsPerClient", label: "Transactions / client" },
  { key: "quotations", label: "Quotations" },
  { key: "attachmentSizeKb", label: "Attachment size", suffix: "KB" },
  { key: "attachmentsPerTx", label: "Attachments / transaction" },
  { key: "noteLength", label: "Note length", suffix: "chars" },
]

export function AdminPlansPage() {
  const { getToken } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Plan>>({})

  useEffect(() => {
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
    load()
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
        is_active: draft.is_active,
        monthly_price_usd: draft.monthly_price_usd,
        yearly_price_usd: draft.yearly_price_usd,
        monthly_discount_pct: draft.monthly_discount_pct,
        yearly_discount_pct: draft.yearly_discount_pct,
        limits: draft.limits,
        geo_pricing: draft.geo_pricing,
      })
      toast.success(`Plan "${updated.name}" saved`)
      setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)))
      setDrafts((d) => ({ ...d, [id]: updated }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48 bg-slate-800" />
        <Skeleton className="h-32 w-full bg-slate-800" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="text-sm text-slate-400 mt-1">Pricing, discounts, and per-plan limits. Geo pricing is keyed by ISO 3166-1 alpha-2 country code.</p>
      </div>

      {plans.map((p) => {
        const draft = drafts[p.id]
        return (
          <Card key={p.id} className="bg-slate-900 border-slate-800 p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={draft.name}
                    onChange={(e) => updateDraft(p.id, { name: e.target.value })}
                    className="text-lg font-semibold bg-slate-950 border-slate-800 max-w-xs"
                  />
                  <span className="text-xs uppercase tracking-widest text-slate-500">{p.key}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={draft.is_active} onCheckedChange={(v) => updateDraft(p.id, { is_active: v })} />
                  <span className="text-xs text-slate-400">{draft.is_active ? "Active" : "Disabled"}</span>
                </div>
              </div>
              <Button onClick={() => handleSave(p.id)} disabled={savingId === p.id} className="bg-amber-500 text-amber-950 hover:bg-amber-400">
                {savingId === p.id ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Save className="size-3.5 mr-1.5" />}
                Save
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly (USD)</Label>
                <Input value={draft.monthly_price_usd} onChange={(e) => updateDraft(p.id, { monthly_price_usd: e.target.value })} className="bg-slate-950 border-slate-800" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Yearly (USD)</Label>
                <Input value={draft.yearly_price_usd} onChange={(e) => updateDraft(p.id, { yearly_price_usd: e.target.value })} className="bg-slate-950 border-slate-800" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly discount %</Label>
                <Input type="number" value={draft.monthly_discount_pct} onChange={(e) => updateDraft(p.id, { monthly_discount_pct: parseInt(e.target.value || "0", 10) })} className="bg-slate-950 border-slate-800" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Yearly discount %</Label>
                <Input type="number" value={draft.yearly_discount_pct} onChange={(e) => updateDraft(p.id, { yearly_discount_pct: parseInt(e.target.value || "0", 10) })} className="bg-slate-950 border-slate-800" />
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Limits</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {LIMIT_FIELDS.map(({ key, label, suffix }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs">{label}</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        value={draft.limits?.[key] ?? 0}
                        onChange={(e) => updateLimit(p.id, key as string, parseInt(e.target.value || "0", 10))}
                        className="bg-slate-950 border-slate-800"
                      />
                      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">{suffix}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Geo pricing</p>
              <div className="space-y-2">
                {Object.entries(draft.geo_pricing).map(([country, cfg]) => (
                  <div key={country} className="grid grid-cols-6 gap-2 items-end border border-slate-800 rounded-md p-3">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Country</Label>
                      <Input value={country} disabled className="bg-slate-950 border-slate-800" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Currency</Label>
                      <Input value={cfg.currency} onChange={(e) => updateGeo(p.id, country, { currency: e.target.value.toUpperCase() })} className="bg-slate-950 border-slate-800" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Monthly (minor)</Label>
                      <Input type="number" value={cfg.monthly} onChange={(e) => updateGeo(p.id, country, { monthly: parseInt(e.target.value || "0", 10) })} className="bg-slate-950 border-slate-800" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Yearly (minor)</Label>
                      <Input type="number" value={cfg.yearly} onChange={(e) => updateGeo(p.id, country, { yearly: parseInt(e.target.value || "0", 10) })} className="bg-slate-950 border-slate-800" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Monthly disc%</Label>
                      <Input type="number" value={cfg.monthlyDiscountPct ?? 0} onChange={(e) => updateGeo(p.id, country, { monthlyDiscountPct: parseInt(e.target.value || "0", 10) })} className="bg-slate-950 border-slate-800" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Yearly disc%</Label>
                      <Input type="number" value={cfg.yearlyDiscountPct ?? 0} onChange={(e) => updateGeo(p.id, country, { yearlyDiscountPct: parseInt(e.target.value || "0", 10) })} className="bg-slate-950 border-slate-800" />
                    </div>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-700 text-slate-300"
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
