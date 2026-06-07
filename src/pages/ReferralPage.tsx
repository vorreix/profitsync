import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Gift, Copy, Check, Share2, Users, BadgeCheck, Wallet, TrendingUp, Link2, Send } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Referral = { id: string; status: string; reward_amount: number; reward_currency: string; qualifying_at: string | null; paid_at: string | null; created_at: string; label: string }
type Payout = { id: string; method: string; amount: string; currency: string; status: string; created_at: string }
type ReferralData = {
  code: string
  referred_by?: { code: string; inviter: string } | null
  stats: { signups: number; paid: number; lifetimeEarned: number; eligibleEarned: number; outstanding: number; available: number; currency: string }
  settings: { reward_type: string; reward_percent: number; reward_amount: number; reward_currency: string; holding_days: number; min_payout: number }
  referrals: Referral[]
  payouts: Payout[]
}

const money = (n: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n)
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

export function ReferralPage() {
  const { getToken } = useAuth()
  const [data, setData] = useState<ReferralData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [applying, setApplying] = useState(false)

  const [payoutOpen, setPayoutOpen] = useState(false)
  const [method, setMethod] = useState<"upi" | "paypal" | "bank">("upi")
  const [payoutAmount, setPayoutAmount] = useState("")
  const [payoutDetails, setPayoutDetails] = useState<Record<string, string>>({})
  const [requesting, setRequesting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      setData(await apiGet<ReferralData>("/api/referrals", token))
    } catch {
      toast.error("Failed to load referrals")
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { load() }, [load])

  const link = data ? `${window.location.origin}/?r=${data.code}` : ""

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  async function copyCode() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: "ProfitSync", text: "Join me on ProfitSync", url: link }) } catch { /* cancelled */ }
    } else {
      copyLink()
    }
  }

  async function applyCode() {
    const code = codeInput.trim()
    if (!code) return
    setApplying(true)
    try {
      const token = await getToken()
      if (!token) throw new Error()
      await apiPost("/api/referrals/apply", token, { code })
      toast.success("Referral code applied")
      setCodeInput("")
      load()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't apply code")
    } finally {
      setApplying(false)
    }
  }

  async function requestPayout() {
    const amt = parseFloat(payoutAmount)
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Enter a valid amount"); return }
    setRequesting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error()
      await apiPost("/api/referrals/payouts", token, { method, amount: amt, details: payoutDetails })
      toast.success("Payout requested")
      setPayoutOpen(false)
      setPayoutAmount("")
      setPayoutDetails({})
      load()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't request payout")
    } finally {
      setRequesting(false)
    }
  }

  if (loading) {
    return <div className="p-3 sm:p-6 space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
  }
  if (!data) return null

  const c = data.stats.currency
  const canPayout = data.stats.available > 0 && data.stats.available >= data.settings.min_payout

  return (
    <div className="p-3 sm:p-6 space-y-5 sm:space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2"><Gift className="size-5 text-primary" /> Refer &amp; earn</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Invite friends and earn {data.settings.reward_type === "percent" ? `${data.settings.reward_percent}% commission` : money(data.settings.reward_amount, c)} when they upgrade.
        </p>
      </div>

      {/* Link */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-1.5"><Link2 className="size-4" /> Your referral link</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {/* Your code (copyable) */}
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your code</p>
              <p className="font-mono text-lg font-semibold tracking-widest">{data.code}</p>
            </div>
            <Button variant="outline" size="sm" onClick={copyCode} className="shrink-0">
              {codeCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="hidden sm:inline">{codeCopied ? "Copied" : "Copy code"}</span>
            </Button>
          </div>
          {/* Share link */}
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={copyLink} className="shrink-0">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}<span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span></Button>
            <Button onClick={share} className="shrink-0"><Share2 className="size-4" /><span className="hidden sm:inline">Share</span></Button>
          </div>
          <p className="text-xs text-muted-foreground">Earnings become available {data.settings.holding_days} days after a referred friend pays.</p>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <StatCard icon={<Users className="size-3.5" />} label="Signups" value={String(data.stats.signups)} />
        <StatCard icon={<BadgeCheck className="size-3.5 text-emerald-500" />} label="Paid referrals" value={String(data.stats.paid)} />
        <StatCard icon={<TrendingUp className="size-3.5" />} label="Total earned" value={money(data.stats.lifetimeEarned, c)} />
        <StatCard icon={<Wallet className="size-3.5 text-primary" />} label="Available" value={money(data.stats.available, c)} />
      </div>

      {/* Payout */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Available balance: {money(data.stats.available, c)}</p>
            <p className="text-xs text-muted-foreground">
              {data.settings.min_payout > 0 ? `Minimum payout ${money(data.settings.min_payout, c)}.` : "Request a payout anytime."}{data.stats.outstanding > 0 ? ` ${money(data.stats.outstanding, c)} pending.` : ""}
            </p>
          </div>
          <Button disabled={!canPayout} onClick={() => { setPayoutAmount(String(data.stats.available)); setPayoutOpen(true) }} className="shrink-0">
            <Send className="size-4" /> Request payout
          </Button>
        </CardContent>
      </Card>

      {/* Activity */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Referral activity</CardTitle></CardHeader>
        <CardContent>
          {data.referrals.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">You haven't referred anyone yet. Share your link to start earning.</p>
          ) : (
            <ul className="divide-y">
              {data.referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={r.status === "paid" || r.status === "paid_out" ? "default" : "secondary"}>{r.status === "signed_up" ? "Signed up" : r.status === "paid" ? "Paid" : "Paid out"}</Badge>
                    {r.reward_amount > 0 && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">{money(r.reward_amount, r.reward_currency)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Payouts history */}
      {data.payouts.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Payout requests</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="capitalize">{p.method} · {fmtDate(p.created_at)}</span>
                  <span className="flex items-center gap-2"><span className="tabular-nums">{money(Number(p.amount), p.currency)}</span><Badge variant="outline" className="capitalize">{p.status}</Badge></span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Already referred → show the inviter; otherwise let them apply a code.
          A code can be applied only once, so these are mutually exclusive. */}
      {data.referred_by ? (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">You were invited</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <p className="text-sm">
              Invited by <span className="font-medium">{data.referred_by.inviter}</span>
            </p>
            <Badge variant="secondary" className="font-mono tracking-widest">{data.referred_by.code}</Badge>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Have a referral code?</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Input placeholder="Enter code" value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} className="font-mono" />
            <Button variant="outline" onClick={applyCode} disabled={applying || !codeInput.trim()} className="shrink-0">Apply</Button>
          </CardContent>
        </Card>
      )}

      {/* Payout dialog */}
      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader><DialogTitle>Request payout</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <Tabs value={method} onValueChange={(v) => setMethod(v as "upi" | "paypal" | "bank")}>
              <TabsList className="w-full"><TabsTrigger value="upi" className="flex-1">UPI</TabsTrigger><TabsTrigger value="paypal" className="flex-1">PayPal</TabsTrigger><TabsTrigger value="bank" className="flex-1">Bank</TabsTrigger></TabsList>
            </Tabs>
            {method === "upi" && (
              <div className="space-y-1.5"><Label>UPI ID</Label><Input value={payoutDetails.upi_id ?? ""} onChange={(e) => setPayoutDetails((d) => ({ ...d, upi_id: e.target.value }))} placeholder="name@bank" /></div>
            )}
            {method === "paypal" && (
              <div className="space-y-1.5"><Label>PayPal email</Label><Input type="email" value={payoutDetails.paypal_email ?? ""} onChange={(e) => setPayoutDetails((d) => ({ ...d, paypal_email: e.target.value }))} placeholder="you@email.com" /></div>
            )}
            {method === "bank" && (
              <div className="grid grid-cols-1 gap-2">
                <Input value={payoutDetails.account_name ?? ""} onChange={(e) => setPayoutDetails((d) => ({ ...d, account_name: e.target.value }))} placeholder="Account holder name" />
                <Input value={payoutDetails.account_number ?? ""} onChange={(e) => setPayoutDetails((d) => ({ ...d, account_number: e.target.value }))} placeholder="Account number" />
                <Input value={payoutDetails.ifsc ?? ""} onChange={(e) => setPayoutDetails((d) => ({ ...d, ifsc: e.target.value }))} placeholder="IFSC / routing" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Amount ({c})</Label>
              <Input type="number" min="0" step="0.01" max={data.stats.available} value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">Available: {money(data.stats.available, c)}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutOpen(false)}>Cancel</Button>
            <Button onClick={requestPayout} disabled={requesting}>{requesting ? "Requesting…" : "Request payout"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="py-0"><CardContent className="p-3 sm:p-4">
      <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">{icon}{label}</p>
      <p className="mt-1 text-base sm:text-xl font-bold tabular-nums truncate">{value}</p>
    </CardContent></Card>
  )
}
