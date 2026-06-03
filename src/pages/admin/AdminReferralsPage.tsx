import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPatch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Settings = {
  reward_type: string; reward_percent: string; reward_amount: string; reward_currency: string
  holding_days: number; min_payout: string; banner_enabled: boolean; banner_text: string
}
type AdminReferral = { id: string; status: string; reward_amount: number; reward_currency: string; reward_type: string | null; qualifying_at: string | null; paid_at: string | null; created_at: string; referrer_email: string | null; referred_email: string | null }
type AdminPayout = { id: string; user_id: string; email: string | null; method: string; details: Record<string, string>; amount: number; currency: string; status: string; note: string; created_at: string }

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

export function AdminReferralsPage() {
  const { getToken } = useAuth()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [referrals, setReferrals] = useState<AdminReferral[]>([])
  const [payouts, setPayouts] = useState<AdminPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const [s, r, p] = await Promise.all([
        apiGet<Settings>("/api/admin/referral-settings", token),
        apiGet<AdminReferral[]>("/api/admin/referrals", token),
        apiGet<AdminPayout[]>("/api/admin/payouts", token),
      ])
      setSettings(s); setReferrals(r); setPayouts(p)
    } catch {
      toast.error("Failed to load referrals")
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { load() }, [load])

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error()
      await apiPatch("/api/admin/referral-settings", token, {
        reward_type: settings.reward_type,
        reward_percent: Number(settings.reward_percent),
        reward_amount: Number(settings.reward_amount),
        reward_currency: settings.reward_currency,
        holding_days: Number(settings.holding_days),
        min_payout: Number(settings.min_payout),
        banner_enabled: settings.banner_enabled,
        banner_text: settings.banner_text,
      })
      toast.success("Settings saved")
    } catch {
      toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  async function setPayoutStatus(id: string, status: string) {
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/admin/payouts/${id}`, token, { status })
      toast.success("Payout updated")
      setPayouts((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)))
    } catch {
      toast.error("Failed to update payout")
    }
  }

  if (loading || !settings) {
    return <div className="p-4 sm:p-6 space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>
  }

  const owed = referrals.filter((r) => r.status === "paid").reduce((s, r) => s + r.reward_amount, 0)
  const upd = (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s))

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Referral program</h1>

      {/* Settings */}
      <Card>
        <CardHeader><CardTitle className="text-base">Program settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Reward type</Label>
              <Select value={settings.reward_type} onValueChange={(v) => upd({ reward_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="percent">Percent of payment</SelectItem><SelectItem value="fixed">Fixed amount</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reward currency</Label>
              <Input value={settings.reward_currency} maxLength={3} onChange={(e) => upd({ reward_currency: e.target.value.toUpperCase() })} />
            </div>
            {settings.reward_type === "percent" ? (
              <div className="space-y-1.5"><Label>Reward percent (%)</Label><Input type="number" min="0" max="100" value={settings.reward_percent} onChange={(e) => upd({ reward_percent: e.target.value })} /></div>
            ) : (
              <div className="space-y-1.5"><Label>Reward amount</Label><Input type="number" min="0" value={settings.reward_amount} onChange={(e) => upd({ reward_amount: e.target.value })} /></div>
            )}
            <div className="space-y-1.5"><Label>Holding period (days)</Label><Input type="number" min="0" max="365" value={settings.holding_days} onChange={(e) => upd({ holding_days: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label>Minimum payout</Label><Input type="number" min="0" value={settings.min_payout} onChange={(e) => upd({ min_payout: e.target.value })} /></div>
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="banner-enabled">Show referral banner to all users</Label>
              <Switch id="banner-enabled" checked={settings.banner_enabled} onCheckedChange={(v) => upd({ banner_enabled: v })} />
            </div>
            <Textarea rows={2} maxLength={300} placeholder="Banner text shown across the app" value={settings.banner_text} onChange={(e) => upd({ banner_text: e.target.value })} />
          </div>
          <Button onClick={saveSettings} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </CardContent>
      </Card>

      {/* Payout requests */}
      <Card>
        <CardHeader><CardTitle className="text-base">Payout requests</CardTitle></CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No payout requests.</p>
          ) : (
            <ul className="divide-y">
              {payouts.map((p) => (
                <li key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.email ?? p.user_id} · <span className="capitalize">{p.method}</span></p>
                    <p className="text-xs text-muted-foreground break-all">{Object.values(p.details || {}).filter(Boolean).join(" · ")} · {fmtDate(p.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(p.amount)}</span>
                    <Badge variant="outline" className="capitalize">{p.status}</Badge>
                    {p.status !== "paid" && p.status !== "rejected" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setPayoutStatus(p.id, "paid")}>Mark paid</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPayoutStatus(p.id, "rejected")}>Reject</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Referrals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Referrals</span>
            <span className="text-sm font-normal text-muted-foreground">Owed (paid, awaiting payout): {new Intl.NumberFormat("en-US", { style: "currency", currency: settings.reward_currency }).format(owed)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No referrals yet.</p>
          ) : (
            <ul className="divide-y">
              {referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate"><span className="text-muted-foreground">{r.referrer_email ?? "—"}</span> → {r.referred_email ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(r.created_at)}{r.qualifying_at ? ` · eligible ${fmtDate(r.qualifying_at)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.reward_amount > 0 && <span className="tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: r.reward_currency }).format(r.reward_amount)}</span>}
                    <Badge variant={r.status === "paid" || r.status === "paid_out" ? "default" : "secondary"} className="capitalize">{r.status.replace("_", " ")}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
