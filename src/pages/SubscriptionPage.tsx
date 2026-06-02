import { useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { apiGet, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { usePlanText } from "@/lib/i18n/plan-text"
import { isPaidPlanKey } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Check,
  CreditCard,
  Crown,
  Download,
  ExternalLink,
  FileText,
  Info,
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
  promo_note: string
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

type ScheduledChange = {
  billing_cycle: string | null
  product_id: string
  effective_at: string
}

type Subscription = {
  id: string
  organization_id: string
  plan_key: string
  status: string
  billing_cycle: string | null
  provider: string | null
  current_period_start: string | null
  current_period_end: string | null
  scheduled_change: ScheduledChange | null
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

/** Yearly savings vs paying monthly for 12 months, using the plan's local (post-discount) prices. */
function yearlySavingsPct(plan: Plan | null): number {
  if (!plan) return 0
  const monthly = discountedAmount(plan.local_pricing.monthly, plan.local_pricing.monthly_discount_pct)
  const yearly = discountedAmount(plan.local_pricing.yearly, plan.local_pricing.yearly_discount_pct)
  if (monthly <= 0 || yearly <= 0) return 0
  return Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100))
}

// The structured limit keys → their translation key. Used when a plan has no
// custom (admin-authored) feature label for that limit.
const LIMIT_LABEL_KEYS: Record<string, string> = {
  clients: "limitClients",
  transactionsPerClient: "limitTransactionsPerClient",
  quotations: "limitQuotations",
  attachmentSizeKb: "limitAttachmentSize",
  attachmentsPerTx: "limitAttachmentsPerItem",
  noteLength: "limitNoteLength",
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
  const { t } = useTranslation("subscription")
  const planText = usePlanText()
  const { getToken } = useAuth()
  const { activeOrg, refresh: refreshOrg } = useOrg()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<PricingResponse | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  // The invoices endpoint reconciles the subscription with Dodo (period dates,
  // scheduled changes, payment history), so its subscription is fresher than the
  // pricing endpoint's snapshot — prefer it as the source of truth.
  const [billingSub, setBillingSub] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly")
  // When already subscribed, the plan cards are hidden behind the manage view.
  // This reveals them again so a user in their grace period can resubscribe.
  const [showPlans, setShowPlans] = useState(false)

  const cycleSuffix = cycle === "yearly" ? t("perYr") : t("perMo")

  // Per-limit value text (units stay readable; "chars" is localized).
  const limitValue = (key: string, val: number): string => {
    if (key === "attachmentSizeKb") return `${(val / 1024).toFixed(1)}MB`
    if (key === "noteLength") return t("charsValue", { value: val.toLocaleString() })
    return val.toLocaleString()
  }

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
      setBillingSub(billing.subscription ?? null)
    } catch {
      toast.error(t("loadPricingFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // On the checkout-return path, the dedicated effect below runs sync + load;
    // skip the initial load here so the two don't reconcile concurrently.
    if (new URLSearchParams(window.location.search).get("dodo") === "return") return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, activeOrg?.id])

  // Reconcile when the user returns from the Dodo hosted checkout.
  useEffect(() => {
    if (searchParams.get("dodo") !== "return") return
    let cancelled = false
      ; (async () => {
        try {
          const token = await getToken()
          if (!token) return
          const result = await apiPost<{ subscription?: Subscription; synced?: boolean }>("/api/billing/sync", token, {})
          if (cancelled) return
          const status = result.subscription?.status
          if (status === "active") {
            toast.success(t("paymentConfirmed"))
            await refreshOrg()
          } else if (status === "pending") {
            toast.message(t("paymentProcessing"), { description: t("paymentProcessingDesc") })
          } else {
            toast.message(t("checkoutClosed"), { description: t("checkoutClosedDesc") })
          }
        } catch {
          toast.error(t("confirmFailed"))
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
      toast.success(result.message || t("subscriptionUpdated"))
      await refreshOrg()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failed"))
    } finally {
      setBusy(null)
    }
  }

  const handleCancel = async (renewDate: string | null, planName: string) => {
    if (!activeOrg) return
    if (!window.confirm(t("cancelConfirm", { name: planName, date: formatDate(renewDate) }))) return
    setBusy("cancel")
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ message?: string }>("/api/billing/cancel", token, {})
      toast.success(result.message || t("subscriptionCancelled"))
      await refreshOrg()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failed"))
    } finally {
      setBusy(null)
    }
  }

  const handleSwitchToYearly = async () => {
    if (!activeOrg) return
    if (!window.confirm(t("switchConfirm"))) return
    setBusy("change")
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ message?: string }>("/api/billing/change-plan", token, { cycle: "yearly" })
      toast.success(result.message || t("switchSuccess"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failed"))
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
        toast.error((body as { error?: string }).error || t("noInvoiceDoc"))
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
      toast.error(t("downloadFailed"))
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

  const current = billingSub ?? data.currentSubscription
  const effectivePlanKey = (current?.status === "active" || current?.status === "trialing") ? (current?.plan_key ?? "free") : "free"
  const isPersonal = activeOrg?.account_type === "personal"
  const hiddenLimitKeys = isPersonal ? new Set(["clients", "quotations"]) : new Set<string>()

  const freePlan = data.plans.find((p) => p.key === "free") ?? null
  const paidPlan = data.plans.find((p) => p.key !== "free") ?? null
  // Free first, then the paid ("Pro") plan — render in a fixed, predictable order.
  const orderedPlans = [freePlan, paidPlan].filter((p): p is Plan => !!p)
  const savingsPct = yearlySavingsPct(paidPlan)

  // Subscription state machine for the page layout:
  //  - active paid plan, or a cancelled plan still inside its paid period → "manage" view (banner, no cards)
  //  - otherwise (free / pending / lapsed) → "choose a plan" view (cards)
  const isPaid = !!current && isPaidPlanKey(current.plan_key)
  const isActivePaid = isPaid && current!.status === "active"
  const inGracePeriod =
    isPaid &&
    current!.status === "cancelled" &&
    !!current!.cancel_at &&
    new Date(current!.cancel_at).getTime() > Date.now()
  const manageView = isActivePaid || inGracePeriod
  const showCards = !manageView || showPlans

  const planForCurrent = current ? data.plans.find((p) => p.key === current.plan_key) ?? null : null
  const currentPlanName = planForCurrent ? planText(planForCurrent.name) : (current?.plan_key ?? "")
  const scheduled = current?.scheduled_change ?? null

  const planFeatures = (plan: Plan) =>
    Object.keys(LIMIT_LABEL_KEYS)
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

  const showInvoices = manageView || invoices.length > 0

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeOrg ? t("managing", { name: activeOrg.name }) : t("choosePlan")}
          </p>
        </div>
        {/* Billing-cycle toggle only matters while choosing a plan. */}
        {showCards && (
          <CycleToggle cycle={cycle} onChange={setCycle} savingsPct={savingsPct} t={t} />
        )}
      </div>

      {/* ── Manage view: current-plan banner (shown when subscribed) ─────────── */}
      {manageView && current && (
        <Card className="relative overflow-hidden border-primary/40 ring-1 ring-primary/20">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-gradient-to-br from-primary/15 to-transparent blur-3xl" />
          <CardContent className="py-5 space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Crown className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-semibold tracking-tight">
                      {t("youreOn", { name: currentPlanName })}
                    </h2>
                    <Badge className="bg-primary/15 text-primary hover:bg-primary/15 border-0 uppercase tracking-wide text-[10px]">
                      {t("proBadge")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {inGracePeriod ? t("planCancelledLine") : t("planActiveLine")}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="capitalize shrink-0">{current.status}</Badge>
            </div>

            {/* Dates: started + renews/access-ends, sourced from Dodo. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 rounded-lg border bg-muted/30 p-3">
              <Detail
                label={t("billingCycleLabel")}
                value={<span className="capitalize">{current.billing_cycle ? t(current.billing_cycle) : "—"}</span>}
              />
              <Detail
                label={t("started")}
                value={formatDate(current.current_period_start)}
              />
              <Detail
                label={inGracePeriod ? t("accessUntil") : t("renews")}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5 text-muted-foreground" />
                    {formatDate(inGracePeriod ? current.cancel_at : current.current_period_end)}
                  </span>
                }
              />
              {current.provider && (
                <Detail
                  label={t("paymentLabel")}
                  value={current.provider === "dodo" ? t("dodoPayments") : current.provider}
                />
              )}
            </div>

            {/* Scheduled cycle switch (e.g. monthly → yearly takes effect next renewal). */}
            {scheduled && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <CalendarClock className="size-4 text-primary shrink-0 mt-0.5" />
                <span>
                  {t("scheduledSwitchNotice", {
                    cycle: scheduled.billing_cycle ? t(scheduled.billing_cycle) : t("yourNewPlan"),
                    date: formatDate(scheduled.effective_at),
                  })}
                </span>
              </div>
            )}

            {/* Upgrade monthly → yearly (only while active, monthly, with no pending switch). */}
            {isActivePaid && current.billing_cycle === "monthly" && !scheduled && savingsPct > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{t("switchToYearly")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("switchToYearlyDesc", { pct: savingsPct })}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleSwitchToYearly()}
                  disabled={busy === "change"}
                >
                  {busy === "change" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <ArrowRight className="size-3.5 mr-1.5" />}
                  {t("switchToYearlyCta", { pct: savingsPct })}
                </Button>
              </div>
            )}

            {/* Cancel (active) or resubscribe (grace period). */}
            {isActivePaid && (
              <div className="space-y-2 border-t pt-4">
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="size-3.5 shrink-0 mt-0.5" />
                  {t("cancelNote")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleCancel(current.current_period_end, currentPlanName)}
                  disabled={busy === "cancel"}
                >
                  {busy === "cancel" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <ShieldOff className="size-3.5 mr-1.5" />}
                  {t("cancelSubscription")}
                </Button>
              </div>
            )}
            {inGracePeriod && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  {t("resubscribeNote", { date: formatDate(current.cancel_at) })}
                </p>
                <Button size="sm" onClick={() => setShowPlans(true)}>
                  <Sparkles className="size-3.5 mr-1.5" />
                  {t("resubscribe")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Choose-a-plan view: Free + Pro cards ─────────────────────────────── */}
      {showCards && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orderedPlans.map((plan) => {
            const isFree = plan.key === "free"
            const isCurrent = effectivePlanKey === plan.key
            const local = plan.local_pricing
            const base = cycle === "yearly" ? local.yearly : local.monthly
            const discount = cycle === "yearly" ? local.yearly_discount_pct : local.monthly_discount_pct
            const finalAmount = discountedAmount(base, discount)
            const promo = planText(plan.promo_note) ||
              (discount > 0 ? t(cycle === "yearly" ? "promoFirstYear" : "promoFirstMonth", { discount }) : "")
            return (
              <Card
                key={plan.id}
                className={`relative overflow-hidden ${isCurrent
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
                        <Sparkles className="size-3" /> {t("recommended")}
                      </span>
                    )}
                  </>
                )}
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {planText(plan.name)}
                      {!isFree && (
                        <Badge className="bg-primary/15 text-primary hover:bg-primary/15 border-0 uppercase tracking-wide text-[10px]">
                          {t("proBadge")}
                        </Badge>
                      )}
                    </span>
                    {isCurrent && <Badge>{t("current")}</Badge>}
                  </CardTitle>
                  <div className="pt-1">
                    {isFree ? (
                      <p className="text-3xl font-semibold">{t("free")}</p>
                    ) : (
                      <div>
                        {discount > 0 && (
                          <p className="text-sm text-muted-foreground line-through">
                            {formatMinor(base, local.currency)}<span className="text-xs">{cycleSuffix}</span>
                          </p>
                        )}
                        <p className="text-3xl font-semibold">
                          {formatMinor(finalAmount, local.currency)}
                          <span className="text-sm font-normal text-muted-foreground ml-1">{cycleSuffix}</span>
                        </p>
                        {cycle === "yearly" && savingsPct > 0 && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{t("saveBadge", { pct: savingsPct })}</p>
                        )}
                        {promo && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{promo}</p>
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
                          ? <span>{planText(custom)}</span>
                          : <span><span className="text-muted-foreground">{t(LIMIT_LABEL_KEYS[key] ?? key)}:</span> {limitValue(key, val)}</span>}
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
                      ? t("currentPlan")
                      : isFree
                        ? t("switchToFree")
                        : current?.plan_key === plan.key && current?.status === "pending"
                          ? t("completePayment")
                          : (
                            <>
                              {t("upgradeTo", { name: planText(plan.name) })}
                              <ExternalLink className="size-3.5 ml-1" />
                            </>
                          )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Invoices ─────────────────────────────────────────────────────────── */}
      {showInvoices && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            <h2 className="text-base font-semibold tracking-tight">{t("billingTitle")}</h2>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Receipt className="size-4" /> {t("invoicesTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {invoices.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("noInvoices")}
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
                          title={t("downloadInvoice")}
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

/** Prominent, easy-to-read monthly/yearly segmented control with a savings badge. */
function CycleToggle({
  cycle,
  onChange,
  savingsPct,
  t,
}: {
  cycle: "monthly" | "yearly"
  onChange: (c: "monthly" | "yearly") => void
  savingsPct: number
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <div className="inline-flex items-center rounded-xl border bg-muted/60 p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
          cycle === "monthly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {t("monthly")}
      </button>
      <button
        type="button"
        onClick={() => onChange("yearly")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
          cycle === "yearly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {t("yearly")}
        {savingsPct > 0 && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-700 dark:text-emerald-300">
            {t("saveBadge", { pct: savingsPct })}
          </span>
        )}
      </button>
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
