import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { AlertTriangle, ArrowRight, CalendarClock, CircleAlert, CreditCard, Gift, Sparkles, TrendingUp, X } from "lucide-react"
import type { Alert, AlertSeverity } from "@/lib/alerts"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel"
import { isSnoozed, readSnoozed, snooze, writeSnoozed, type Snoozed } from "@/components/alerts/alert-dismissals"

/**
 * The attention rail: everything the workspace needs the user to know, as one
 * swipeable, dot-indicated carousel at the top of the DASHBOARD.
 *
 * Dashboard only, on purpose. An attention rail in the app shell would sit on
 * top of every screen forever, which costs the same vertical space on pages
 * that have nothing to do with it and quickly trains people to read the whole
 * strip as an ad. The dashboard is where someone goes to ask what is going on
 * with their money.
 *
 * It absorbs the old referral banner as its lowest-priority slide. When there
 * is nothing to say it renders NOTHING — on a healthy workspace this component
 * is invisible.
 *
 * Deliberate choices, each one a trap avoided:
 *  • NO AUTO-ADVANCE. A slide that says "your card payment failed" must not
 *    slide away while it is being read, or under a thumb reaching for it.
 *  • The dots are real buttons in a tablist, not decoration. The vendored
 *    carousel's root is not focusable, so its arrow-key handler only fires once
 *    focus is already inside — without real controls a keyboard user could
 *    never reach slide two.
 *  • Inactive slides are hidden from assistive tech. Embla moves a flex track
 *    with a transform, so every off-screen slide stays in the accessibility
 *    tree and in the tab order unless it is taken out.
 *  • The selected slide is tracked BY ID. These items are re-derived on every
 *    refetch and re-ranked by severity, so index-based selection would swap the
 *    content under a thumb whenever anything anywhere changed.
 */

const ICONS: Record<string, typeof CircleAlert> = {
  card_payment_overdue: CreditCard,
  card_autopay_failed: CircleAlert,
  card_payment_due_soon: CreditCard,
  card_autopay_scheduled: CreditCard,
  charge_shortfall: AlertTriangle,
  card_expired: CreditCard,
  card_expiring: CreditCard,
  card_utilization_high: TrendingUp,
  recurring_paused: CalendarClock,
  recurring_upcoming: CalendarClock,
  recurring_posted: Sparkles,
  income_received: TrendingUp,
  referral: Gift,
}

// Matched to the tones already used on the card and credit panels rather than a
// new palette, so a "danger" here reads as the same red as a danger there.
const TONE: Record<AlertSeverity, { box: string; icon: string; dot: string }> = {
  danger: {
    box: "border-red-500/40 bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    icon: "text-red-600 dark:text-red-400",
    dot: "bg-red-600 dark:bg-red-400",
  },
  warning: {
    box: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    icon: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-600 dark:bg-amber-400",
  },
  info: {
    box: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    icon: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-600 dark:bg-sky-400",
  },
  success: {
    box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-600 dark:bg-emerald-400",
  },
  promo: {
    box: "border-primary/30 bg-primary/5 text-foreground",
    icon: "text-primary",
    dot: "bg-primary",
  },
}

type AlertsResponse = { items: Alert[]; today: string }
type ReferralSettings = { settings?: { banner_enabled?: boolean; banner_text?: string } }

export function AlertsBanner({ className }: { className?: string }) {
  return (
    <BannerBoundary>
      <AlertsRail className={className} />
    </BannerBoundary>
  )
}

function AlertsRail({ className }: { className?: string }) {
  const { t, i18n } = useTranslation("alerts")
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { balancesVisible } = useBalancePrivacy()
  const { activeOrg } = useOrg()

  // Nothing is asked for until the workspace is settled: at boot the active org
  // is still resolving, and a banner is not worth a request that might be
  // answered for a workspace the user is about to leave.
  const { data } = useApiQuery<AlertsResponse>(activeOrg ? "/api/alerts" : null)
  const { data: referral } = useApiQuery<ReferralSettings>(activeOrg ? "/api/referrals" : null)

  const [snoozed, setSnoozed] = useState<Snoozed>(() => readSnoozed(Date.now()))
  const dismiss = useCallback((id: string) => {
    setSnoozed((prev) => {
      const next = snooze(prev, id, Date.now())
      writeSnoozed(next)
      return next
    })
  }, [])

  const items = useMemo(() => {
    const now = Date.now()
    const server = Array.isArray(data?.items) ? data.items : []
    const live = server.filter((a) => !(a.dismissible && isSnoozed(snoozed, a.id, now)))
    const promo = referral?.settings?.banner_enabled ? (referral.settings.banner_text?.trim() ?? "") : ""
    // Marketing never shares a rail with an emergency. Putting "invite a friend"
    // next to "your payment failed" is how a user learns the whole rail is
    // skippable.
    const worst = live.some((a) => a.severity === "danger")
    if (promo && !worst) {
      const id = `referral:${promo}`
      if (!isSnoozed(snoozed, id, now)) {
        live.push({ id, kind: "referral" as Alert["kind"], severity: "promo", key: "referral", params: { text: promo }, link: "/referrals", dismissible: true })
      }
    }
    return live
  }, [data, referral, snoozed])

  const [api, setApi] = useState<CarouselApi>()
  const [selected, setSelected] = useState(0)
  // The id currently in view, so a refetch that re-ranks the list can put the
  // same slide back rather than jumping to whatever is now first.
  const shownId = useRef<string | null>(null)

  useEffect(() => {
    if (!api) return
    const onSelect = () => {
      const i = api.selectedScrollSnap()
      setSelected(i)
      shownId.current = items[i]?.id ?? null
    }
    onSelect()
    api.on("select", onSelect)
    api.on("reInit", onSelect)
    return () => {
      api.off("select", onSelect)
      api.off("reInit", onSelect)
    }
  }, [api, items])

  useEffect(() => {
    if (!api || !shownId.current) return
    const idx = items.findIndex((a) => a.id === shownId.current)
    // Gone means resolved — falling back to the top is right, and it is the one
    // case where the slide SHOULD change under the user.
    if (idx >= 0 && idx !== api.selectedScrollSnap()) api.scrollTo(idx, true)
  }, [api, items])

  if (items.length === 0) return null

  const dir = i18n.dir() === "rtl" ? "rtl" : "ltr"
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

  const render = (a: Alert) => (
    <AlertSlide
      alert={a}
      currency={currency}
      balancesVisible={balancesVisible}
      onOpen={() => a.link && navigate(a.link)}
      onDismiss={a.dismissible ? () => dismiss(a.id) : undefined}
    />
  )

  // One item is not a carousel: no dots, no drag, no region chrome.
  if (items.length === 1) return <div className={className}>{render(items[0])}</div>

  return (
    <div className={className}>
      <Carousel
        // Embla defaults to ltr and derives its scroll sign and edges from it,
        // so in Arabic the rail would start on the wrong end and the highest
        // severity would not be the slide on screen. The key forces the remount
        // embla needs to re-read the direction.
        key={dir}
        setApi={setApi}
        opts={{ direction: dir, align: "start", loop: false, duration: reduced ? 0 : 20 }}
        aria-label={t("region")}
      >
        {/* The vendored carousel's own gutter is physical (-ml-4/pl-4), which
            lands on the wrong side in Arabic. These are the same trick in
            logical properties: the track's negative inline-start margin exactly
            cancels the first slide's padding, whichever side that is. */}
        <CarouselContent className="-ms-2">
          {items.map((a, i) => (
            <CarouselItem
              key={a.id}
              className="basis-full ps-2"
              aria-label={t("slide", { index: i + 1, total: items.length })}
              aria-hidden={i !== selected || undefined}
              inert={i !== selected}
            >
              {render(a)}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* Real controls, not decoration: the carousel root is not focusable, so
          its arrow-key handler never fires for someone who has not already
          tabbed into a slide. */}
      <div role="tablist" aria-label={t("region")} className="mt-1.5 flex items-center justify-center gap-0.5">
        {items.map((a, i) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={i === selected}
            aria-label={t("goTo", { index: i + 1, total: items.length })}
            onClick={() => api?.scrollTo(i)}
            className="pressable flex size-8 items-center justify-center rounded-full"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-all",
                i === selected ? cn("w-4", TONE[a.severity].dot) : "w-1.5 bg-muted-foreground/30",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

function AlertSlide({
  alert,
  currency,
  balancesVisible,
  onOpen,
  onDismiss,
}: {
  alert: Alert
  currency: string
  balancesVisible: boolean
  onOpen: () => void
  onDismiss?: () => void
}) {
  const { t } = useTranslation("alerts")
  const tone = TONE[alert.severity]
  const Icon = ICONS[alert.kind] ?? CircleAlert

  // Amounts are formatted in the org's currency and obey the privacy toggle:
  // the dashboard is exactly where someone hides their balances before handing
  // the phone over, so this must not be the one thing that keeps showing them.
  const params: Record<string, string | number> = { ...alert.params }
  for (const [name, value] of Object.entries(alert.money ?? {})) {
    params[name] = formatMoney(value, currency, balancesVisible)
  }
  if (typeof alert.params.days === "number") params.when = whenLabel(t, Number(alert.params.days), alert.tense)

  const title = alert.kind === "referral" ? String(alert.params.text ?? "") : t(`${alert.key}.title`, params)
  const body = alert.kind === "referral" ? "" : t(`${alert.key}.body`, params)

  return (
    <div data-alert={alert.kind} className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2.5", tone.box)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} aria-hidden />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-start">
        {/* Both lines are clamped so a rail of mixed-length messages — and the
            much longer German and Tamil translations — cannot make the shell
            jump between slides. */}
        <p className="truncate text-sm font-semibold">{title}</p>
        {body && <p className="line-clamp-2 text-xs opacity-90">{body}</p>}
      </button>
      {alert.link && <ArrowRight className="mt-0.5 size-4 shrink-0 opacity-60 rtl:rotate-180" aria-hidden />}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          className="-me-1.5 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/**
 * "today" / "tomorrow" / "in 3 days" / "9 days ago" as one translated fragment.
 *
 * A shared set of plural keys rather than a variant per alert: the day count is
 * the only part that needs a plural form, and Arabic has six categories that a
 * hard-coded "(N day(s))" cannot express.
 */
function whenLabel(t: ReturnType<typeof useTranslation>["t"], days: number, tense: Alert["tense"]): string {
  if (days <= 0) return t("when.today")
  // The tense is carried on the alert, never inferred from severity: a charge
  // landing TOMORROW that the account cannot cover is a danger too, and reading
  // the direction off the tier turned that into "1 day ago".
  if (tense === "past") return t("when.ago", { count: days })
  if (days === 1) return t("when.tomorrow")
  return t("when.inDays", { count: days })
}

/**
 * A banner is never worth taking the dashboard down with it. Without this, a
 * malformed item would put every card, chart and figure on the page behind the
 * app-level error boundary; with it, the rail simply disappears.
 */
class BannerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[alerts] banner failed", error, info.componentStack)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
