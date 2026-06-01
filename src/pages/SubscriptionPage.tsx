import { useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Check,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Loader as Loader2,
  Receipt,
  ShieldOff,
  Sparkles,
} from "lucide-react"

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
  feature_labels: Record<string, string>
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

type Invoice = {
  id: string
  amount: string
  currency: string
  status: string
  provider: string | null
  provider_invoice_id: string | null
  pdf_url: string | null
  issued_at: string | null
  paid_at: string | null
  created_at: string
}

type PricingResponse = {
  plans: Plan[]
  currentSubscription: Subscription | null
  detectedCountry: string
}

function formatMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 0 }).format(amount / 100)
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value.split("T")[0] : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function discountedAmount(amount: number, discountPct: number): number {
  // Round the discounted cents like Dodo does, so this matches the actual charge.
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

const INVOICE_BADGE: Record<string, string> = {
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  open: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  draft: "border-border bg-muted text-muted-foreground",
  void: "border-border bg-muted text-muted-foreground",
  uncollectible: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  refunded: "border-border bg-muted text-muted-foreground",
}

export function SubscriptionPage() {
  const { getToken } = useAuth()
  const { activeOrg, refresh: refreshOrg } = useOrg()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<PricingResponse | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly")

  async function load() {
    try {
      const token = await getToken()
      if (!token) return
      const [pricing, billing] = await Promise.all([
        apiGet<PricingResponse>("/api/billing/pricing", token),
        apiGet<{ invoices: Invoice[]; subscription: Subscription | null }>("/api/billing/invoices", token).catch(
          () => ({ invoices: [] as Invoice[], subscription: null }),
        ),
      ])
      setData(pricing)
      setInvoices(billing.invoices ?? [])
    } catch {
      toast.error("Failed to load pricing")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, activeOrg?.id])

  // Reconcile when the user returns from the Dodo hosted checkout.
  useEffect(() => {
    if (searchParams.get("dodo") !== "return") return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const result = await apiPost<{ subscription?: Subscription; synced?: boolean }>("/api/billing/sync", token, {})
        if (cancelled) return
        const status = result.subscription?.status
        if (status === "active") {
          toast.success("Payment confirmed — your plan is now active. 🎉")
          await refreshOrg()
        } else if (status === "pending") {
          toast.message("Payment is processing", { description: "Your plan will activate shortly. Refresh in a moment." })
        } else {
          toast.message("Checkout closed", { description: "Your subscription is still pending. You can retry anytime." })
        }
      } catch {
        toast.error("Could not confirm payment status")
      } finally {
        if (!cancelled) {
          for (const k of ["dodo", "subscription_id", "status", "email"]) searchParams.delete(k)
          setSearchParams(searchParams, { replace: true })
          load()
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleSubscribe = async (planKey: string) => {
    if (!activeOrg) return
    setBusy(planKey)
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{
        subscription?: Subscription
        checkout_url?: string | null
        message?: string
      }>(
        "/api/billing/create-subscription",
        token,
        { plan_key: planKey, cycle: planKey === "free" ? undefined : cycle },
      )
      if (result.checkout_url) {
        window.location.href = result.checkout_url
        return
      }
      toast.success(result.message || "Subscription updated")
      await refreshOrg()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const handleCancel = async () => {
    if (!activeOrg) return
    if (!window.confirm("Cancel the subscription? Paid features remain until the end of the current period.")) return
    setBusy("cancel")
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ message?: string }>("/api/billing/cancel", token, {})
      toast.success(result.message || "Subscription cancelled")
      await refreshOrg()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const handleDownloadInvoice = async (invoice: Invoice) => {
    setDownloading(invoice.id)
    try {
      const token = await getToken()
      if (!token || !activeOrg) return
      const res = await fetch(`/api/billing/invoice-pdf?id=${invoice.id}`, {
        headers: { Authorization: `Bearer ${token}`, "x-org-id": activeOrg.id },
      })
      const contentType = res.headers.get("content-type") ?? ""
      if (!res.ok) {
        const body = contentType.includes("json") ? await res.json().catch(() => ({})) : {}
        toast.error((body as { error?: string }).error || "No invoice document is available yet.")
        return
      }
      if (contentType.includes("application/json")) {
        const body = (await res.json()) as { url?: string }
        if (body.url) window.open(body.url, "_blank", "noopener")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      toast.error("Failed to download the invoice")
    } finally {
      setDownloading(null)
    }
  }

  if (loading || !data) {
    return (
      <div className="p-3 sm:p-6 space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    )
  }

  const current = data.currentSubscription
  const effectivePlanKey = (current?.status === "active" || current?.status === "trialing") ? (current?.plan_key ?? "free") : "free"
  const isCancelling = current?.status === "cancelled" && current.cancel_at
  const isPersonal = activeOrg?.account_type === "personal"
  const hiddenLimitKeys = isPersonal ? new Set(["clients", "quotations"]) : new Set<string>()

  const freePlan = data.plans.find((p) => p.key === "free") ?? null
  const paidPlan = data.plans.find((p) => p.key !== "free") ?? null
  // Free first, then the paid ("Pro") plan — render in a fixed, predictable order.
  const orderedPlans = [freePlan, paidPlan].filter((p): p is Plan => !!p)

  const isSubscribed = effectivePlanKey !== "free"
  const showBilling = isSubscribed || invoices.length > 0

  const planFeatures = (plan: Plan) =>
    Object.keys(LIMIT_LABELS)
      .filter((key) => {
        if (hiddenLimitKeys.has(key)) return false
        const custom = plan.feature_labels?.[key]
        const val = plan.limits?.[key] ?? 0
        return !!custom || val > 0
      })
      .map((key) => {
        const custom = plan.feature_labels?.[key]
        const val = plan.limits?.[key] ?? 0
        return { key, custom, val }
      })

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Subscription</h1>
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

      {/* Plan cards: Free + Pro. The user's current plan is clearly highlighted. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {orderedPlans.map((plan) => {
          const isFree = plan.key === "free"
          const isCurrent = effectivePlanKey === plan.key
          const local = plan.local_pricing
          const base = cycle === "yearly" ? local.yearly : local.monthly
          const discount = cycle === "yearly" ? local.yearly_discount_pct : local.monthly_discount_pct
          const finalAmount = discountedAmount(base, discount)
          return (
            <Card
              key={plan.id}
              className={`relative overflow-hidden ${
                isCurrent
                  ? "border-primary ring-1 ring-primary/40"
                  : !isFree
                    ? "border-primary/30"
                    : ""
              }`}
            >
              {!isFree && (
                <>
                  <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-gradient-to-br from-primary/15 to-transparent blur-2xl" />
                  {!isCurrent && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      <Sparkles className="size-3" /> Recommended
                    </span>
                  )}
                </>
              )}
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {plan.name}
                    {!isFree && (
                      <Badge className="bg-primary/15 text-primary hover:bg-primary/15 border-0 uppercase tracking-wide text-[10px]">
                        Pro
                      </Badge>
                    )}
                  </span>
                  {isCurrent && <Badge>Current</Badge>}
                </CardTitle>
                <div className="pt-1">
                  {isFree ? (
                    <p className="text-3xl font-semibold">Free</p>
                  ) : (
                    <div>
                      {discount > 0 && (
                        <p className="text-sm text-muted-foreground line-through">
                          {formatMinor(base, local.currency)}<span className="text-xs">/{cycle === "yearly" ? "yr" : "mo"}</span>
                        </p>
                      )}
                      <p className="text-3xl font-semibold">
                        {formatMinor(finalAmount, local.currency)}
                        <span className="text-sm font-normal text-muted-foreground ml-1">/{cycle === "yearly" ? "yr" : "mo"}</span>
                      </p>
                      {discount > 0 && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          First {cycle === "yearly" ? "year" : "month"} {discount}% off
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1.5 text-sm">
                  {planFeatures(plan).map(({ key, custom, val }) => (
                    <li key={key} className="flex items-center gap-2">
                      <Check className="size-3.5 text-emerald-500 shrink-0" />
                      {custom
                        ? <span>{custom}</span>
                        : <span><span className="text-muted-foreground">{LIMIT_LABELS[key] ?? key}:</span> {formatLimitValue(key, val)}</span>}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  disabled={(isCurrent && current?.status === "active") || busy === plan.key}
                  variant={isCurrent ? "outline" : isFree ? "secondary" : "default"}
                  onClick={() => handleSubscribe(plan.key)}
                >
                  {busy === plan.key ? <Loader2 className="size-3.5 mr-2 animate-spin" /> : null}
                  {isCurrent && current?.status === "active"
                    ? "Current plan"
                    : isFree
                      ? "Switch to Free"
                      : current?.plan_key === plan.key && current?.status !== "active"
                        ? "Complete payment"
                        : (
                          <>
                            Upgrade to {plan.name}
                            <ExternalLink className="size-3.5 ml-1" />
                          </>
                        )}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Billing & payments — shown once the workspace has a paid plan or invoice history. */}
      {showBilling && current && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold tracking-tight">Billing &amp; payments</h2>
          </div>

          <Card>
            <CardContent className="py-4 space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Detail label="Plan" value={<span className="font-medium capitalize">{current.plan_key}</span>} />
                <Detail
                  label="Status"
                  value={<Badge variant="outline" className="capitalize">{current.status}</Badge>}
                />
                <Detail label="Billing cycle" value={<span className="capitalize">{current.billing_cycle ?? "—"}</span>} />
                <Detail
                  label={isCancelling ? "Access ends" : "Renews"}
                  value={current.current_period_end ? formatDate(current.current_period_end) : "—"}
                />
              </div>
              {current.provider && (
                <p className="text-xs text-muted-foreground">
                  Payments handled securely by{" "}
                  <span className="capitalize font-medium">{current.provider === "dodo" ? "Dodo Payments" : current.provider}</span>.
                </p>
              )}
              {current.plan_key !== "free" && current.status === "active" && (
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={busy === "cancel"}>
                  {busy === "cancel" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <ShieldOff className="size-3.5 mr-1.5" />}
                  Cancel subscription
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Receipt className="size-4" /> Invoices
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {invoices.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No invoices yet. They'll appear here after your first payment.
                </div>
              ) : (
                <div className="divide-y">
                  {invoices.map((inv) => {
                    const date = inv.paid_at ?? inv.issued_at ?? inv.created_at
                    const badgeClass = INVOICE_BADGE[inv.status] ?? INVOICE_BADGE.draft
                    return (
                      <div key={inv.id} className="flex items-center gap-3 py-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                          <FileText className="size-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{formatMoney(Number(inv.amount), inv.currency)}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(date)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${badgeClass}`}>
                          {inv.status}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          title="Download invoice"
                          onClick={() => handleDownloadInvoice(inv)}
                          disabled={downloading === inv.id}
                        >
                          {downloading === inv.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{value}</div>
    </div>
  )
}
