import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Check, CreditCard, ExternalLink, Loader as Loader2, ShieldOff, Sparkles } from "lucide-react"

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
  country: string
  local_pricing: {
    currency: string
    monthly: number
    yearly: number
    monthly_discount_pct: number
    yearly_discount_pct: number
  }
}

type Subscription = {
  id: string
  organization_id: string
  plan_key: string
  status: string
  billing_cycle: string | null
  provider: string | null
  current_period_end: string | null
  cancel_at: string | null
  cancelled_at: string | null
}

type PricingResponse = {
  plans: Plan[]
  currentSubscription: Subscription | null
  detectedCountry: string
}

function formatMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 0 }).format(amount / 100)
}

function discountedAmount(amount: number, discountPct: number): number {
  return Math.round(amount * (1 - discountPct / 100))
}

const LIMIT_LABELS: Record<string, string> = {
  clients: "Clients",
  transactionsPerClient: "Transactions per client",
  quotations: "Quotations",
  attachmentSizeKb: "Attachment size",
  attachmentsPerTx: "Attachments per item",
  noteLength: "Note length",
}

function formatLimitValue(key: string, val: number): string {
  if (key === "attachmentSizeKb") return `${(val / 1024).toFixed(1)}MB`
  if (key === "noteLength") return `${val.toLocaleString()} chars`
  return val.toLocaleString()
}

export function SubscriptionPage() {
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const [data, setData] = useState<PricingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly")

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<PricingResponse>("/api/billing/pricing", token)
        setData(res)
      } catch {
        toast.error("Failed to load pricing")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [getToken, activeOrg?.id])

  const handleSubscribe = async (planKey: string) => {
    if (!activeOrg) return
    setBusy(planKey)
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ subscription?: Subscription; checkout_url?: string; message?: string }>(
        "/api/billing/create-subscription",
        token,
        { plan_key: planKey, cycle: planKey === "free" ? undefined : cycle },
      )
      if (result.checkout_url) {
        window.open(result.checkout_url, "_blank")
        toast.message("Complete payment in the opened tab", {
          description: "Once paid, your plan will activate via webhook.",
        })
      } else {
        toast.success(result.message || "Subscription updated")
      }
      const fresh = await apiGet<PricingResponse>("/api/billing/pricing", token)
      setData(fresh)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const handleCancel = async () => {
    if (!activeOrg) return
    if (!window.confirm("Cancel the subscription? Premium features remain until the end of the current period.")) return
    setBusy("cancel")
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ message?: string }>("/api/billing/cancel", token, {})
      toast.success(result.message || "Subscription cancelled")
      const fresh = await apiGet<PricingResponse>("/api/billing/pricing", token)
      setData(fresh)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  if (loading || !data) {
    return (
      <div className="p-6 space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  const current = data.currentSubscription
  const isCancelling = current?.status === "cancelled" && current.cancel_at

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeOrg ? `Managing ${activeOrg.name}` : "Choose the plan that fits your team."}
            <span className="ml-2 text-xs">· Pricing for {data.detectedCountry}</span>
          </p>
        </div>
        <Tabs value={cycle} onValueChange={(v) => setCycle(v as typeof cycle)}>
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly">Yearly</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {current && (
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            <CreditCard className="size-4 text-muted-foreground" />
            <div className="text-sm">
              <p>
                Current plan: <span className="font-medium capitalize">{current.plan_key}</span>{" "}
                <Badge variant="outline" className="ml-1 capitalize">{current.status}</Badge>
                {current.billing_cycle && <span className="ml-2 text-muted-foreground">({current.billing_cycle})</span>}
              </p>
              {current.current_period_end && (
                <p className="text-xs text-muted-foreground">
                  {isCancelling ? "Access ends" : "Renews"} on {current.current_period_end.split("T")[0]}
                </p>
              )}
            </div>
            {current.plan_key !== "free" && current.status === "active" && (
              <Button variant="outline" size="sm" className="ml-auto" onClick={handleCancel} disabled={busy === "cancel"}>
                {busy === "cancel" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <ShieldOff className="size-3.5 mr-1" />}
                Cancel subscription
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {data.plans.map((plan) => {
          const isCurrent = current?.plan_key === plan.key
          const local = plan.local_pricing
          const base = cycle === "yearly" ? local.yearly : local.monthly
          const discount = cycle === "yearly" ? local.yearly_discount_pct : local.monthly_discount_pct
          const finalAmount = discountedAmount(base, discount)
          const isFree = plan.key === "free"
          return (
            <Card key={plan.id} className={isCurrent ? "border-primary" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {plan.name}
                    {plan.key === "premium" && <Sparkles className="size-4 text-amber-500" />}
                  </span>
                  {isCurrent && <Badge>Current</Badge>}
                </CardTitle>
                <div className="pt-1">
                  {isFree ? (
                    <p className="text-3xl font-semibold">Free</p>
                  ) : (
                    <div>
                      <p className="text-3xl font-semibold">
                        {formatMinor(finalAmount, local.currency)}
                        <span className="text-sm font-normal text-muted-foreground ml-1">/{cycle === "yearly" ? "yr" : "mo"}</span>
                      </p>
                      {discount > 0 && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          {discount}% off · was {formatMinor(base, local.currency)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(plan.limits).map(([key, val]) => (
                    <li key={key} className="flex items-center gap-2">
                      <Check className="size-3.5 text-emerald-500 shrink-0" />
                      <span><span className="text-muted-foreground">{LIMIT_LABELS[key] ?? key}:</span> {formatLimitValue(key, val)}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  disabled={(isCurrent && current?.status === "active") || busy === plan.key}
                  variant={isCurrent ? "outline" : "default"}
                  onClick={() => handleSubscribe(plan.key)}
                >
                  {busy === plan.key ? <Loader2 className="size-3.5 mr-2 animate-spin" /> : null}
                  {isCurrent && current?.status === "active"
                    ? "Current plan"
                    : isFree
                      ? "Switch to Free"
                      : current?.plan_key === plan.key
                        ? "Reactivate"
                        : (
                          <>
                            Subscribe
                            {!isFree && <ExternalLink className="size-3.5 ml-1" />}
                          </>
                        )}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
