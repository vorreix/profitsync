import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, Landmark, Loader as Loader2, Plus, Target, Wallet } from "lucide-react"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { BUDGET_PERIODS, type BudgetPeriod } from "@/lib/budget"
import { getCurrencySymbol } from "@/lib/currencies"
import type { AccountType, Client, WealthAccount } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BankNameCombobox } from "@/components/wealth/BankNameCombobox"

const PERIOD_KEY: Record<BudgetPeriod, string> = {
  lifetime: "budget.lifetime",
  monthly: "budget.monthly",
  weekly: "budget.weekly",
  daily: "budget.daily",
}

/** A large, friendly amount field with the currency symbol as a prefix. */
function AmountField({
  id, value, onChange, symbol, autoFocus, big = false,
}: {
  id?: string; value: string; onChange: (v: string) => void; symbol: string; autoFocus?: boolean; big?: boolean
}) {
  return (
    <div className="relative">
      <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground ${big ? "text-2xl" : "text-sm"}`}>
        {symbol}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className={big ? "h-16 pl-9 text-3xl font-semibold tracking-tight" : "h-11 pl-8"}
      />
    </div>
  )
}

/** Compact, tappable period selector (chips). */
function PeriodChips({ value, onChange }: { value: BudgetPeriod; onChange: (v: BudgetPeriod) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      {BUDGET_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={value === p}
          className={`pressable ios-tap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            value === p ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          {t(PERIOD_KEY[p])}
        </button>
      ))}
    </div>
  )
}

const SUBS = 3

/**
 * The "set up your money" wizard — ONE question per screen (cash → bank → budget),
 * mobile-first, no scrolling, with animated slide transitions. Everything is
 * optional and best-effort: on finish each create fires independently (a failure,
 * e.g. quota, is non-blocking) so the user always continues. The org already
 * exists, so it POSTs straight to /api/wealth/accounts + /api/budgets.
 */
export function MoneyWizard({
  accountType,
  currency,
  onBack,
  onDone,
}: {
  accountType: AccountType
  currency: string
  onBack: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const isBusiness = accountType === "business"
  const symbol = getCurrencySymbol(currency)

  const [sub, setSub] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [submitting, setSubmitting] = useState(false)

  const [cash, setCash] = useState("")
  const [bankName, setBankName] = useState("")
  const [bankBalance, setBankBalance] = useState("")
  const [bankDomain, setBankDomain] = useState("")
  const [bankLogo, setBankLogo] = useState("")
  const [personalAmt, setPersonalAmt] = useState("")
  const [personalPeriod, setPersonalPeriod] = useState<BudgetPeriod>("monthly")
  const [companyAmt, setCompanyAmt] = useState("")
  const [companyPeriod, setCompanyPeriod] = useState<BudgetPeriod>("monthly")
  const [showDefault, setShowDefault] = useState(false)
  const [defaultAmt, setDefaultAmt] = useState("")
  const [defaultPeriod, setDefaultPeriod] = useState<BudgetPeriod>("monthly")
  const [ownClientId, setOwnClientId] = useState<string | null>(null)

  useEffect(() => {
    if (!isBusiness) return
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      try {
        const cls = await apiGet<Client[] | { data: Client[] }>("/api/clients", token)
        const list = Array.isArray(cls) ? cls : (cls?.data ?? [])
        if (!cancelled) setOwnClientId(list.find((c) => c.is_own)?.id ?? null)
      } catch {
        /* resolved again on finish if needed */
      }
    })()
    return () => { cancelled = true }
  }, [isBusiness, getToken])

  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

  const finish = async () => {
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) { onDone(); return }
      const tasks: Promise<unknown>[] = []
      const cashN = num(cash)
      if (cashN) {
        // GET auto-provisions the single Cash account if missing; set its balance via
        // PATCH (handles both a fresh workspace and one that already has a 0 cash row,
        // where a second cash POST would be rejected).
        tasks.push(
          (async () => {
            try {
              const accs = await apiGet<WealthAccount[]>("/api/wealth/accounts", token)
              const cashAcc = accs.find((a) => a.type === "cash" && !a.archived_at)
              if (cashAcc) await apiPatch(`/api/wealth/accounts/${cashAcc.id}`, token, { current_balance: cashN })
              else await apiPost("/api/wealth/accounts", token, { type: "cash", opening_balance: cashN })
            } catch {
              /* best-effort */
            }
          })(),
        )
      }
      if (bankName.trim()) {
        tasks.push(apiPost("/api/wealth/accounts", token, {
          type: "bank",
          bank_name: bankName.trim(),
          opening_balance: num(bankBalance) ?? 0,
          // From the bank-name autocomplete pick — the server stores the logo.
          ...(bankDomain ? { brand_domain: bankDomain } : {}),
          ...(bankLogo ? { logo_url: bankLogo } : {}),
        }).catch(() => {}))
      }
      const addBudget = (clientId: string | null, amt: string, period: BudgetPeriod) => {
        const n = num(amt)
        if (n) tasks.push(apiPost("/api/budgets", token, { client_id: clientId, amount: n, period }).catch(() => {}))
      }
      if (isBusiness) {
        let companyClientId = ownClientId
        if (num(companyAmt) && !companyClientId) {
          try {
            const cls = await apiGet<Client[] | { data: Client[] }>("/api/clients", token)
            const list = Array.isArray(cls) ? cls : (cls?.data ?? [])
            companyClientId = list.find((c) => c.is_own)?.id ?? null
          } catch { /* skip company budget */ }
        }
        if (companyClientId) addBudget(companyClientId, companyAmt, companyPeriod)
        if (showDefault) addBudget(null, defaultAmt, defaultPeriod)
      } else {
        addBudget(null, personalAmt, personalPeriod)
      }
      await Promise.all(tasks)
      onDone()
    } catch {
      toast.error(t("budget.saveFailed"))
      setSubmitting(false)
    }
  }

  const next = () => { if (sub < SUBS - 1) { setDir(1); setSub((s) => s + 1) } else void finish() }
  const back = () => { if (sub === 0) onBack(); else { setDir(-1); setSub((s) => s - 1) } }

  const slide =
    dir === 1
      ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-6 motion-safe:duration-200"
      : "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-6 motion-safe:duration-200"

  return (
    <section className="flex flex-1 flex-col py-5 sm:py-7">
      {/* sub-step dots */}
      <div className="flex items-center justify-center gap-1.5" aria-hidden>
        {Array.from({ length: SUBS }).map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === sub ? "w-6 bg-primary" : i < sub ? "w-3 bg-primary/60" : "w-3 bg-border"}`} />
        ))}
      </div>

      {/* keyed → re-animates on each sub-step change */}
      <div key={sub} className={`flex flex-1 flex-col justify-center ${slide}`}>
        {sub === 0 && (
          <div className="text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Wallet className="size-7" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">
              {isBusiness ? t("onboarding.cashQuestionBusiness") : t("onboarding.cashQuestion")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isBusiness ? t("onboarding.cashHintBusiness") : t("onboarding.balanceInHandHint")}
            </p>
            <div className="mx-auto mt-6 max-w-xs">
              <AmountField value={cash} onChange={setCash} symbol={symbol} autoFocus big />
            </div>
          </div>
        )}

        {sub === 1 && (
          <div className="text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Landmark className="size-7" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">{t("onboarding.bankQuestion")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.freeBankNote")}</p>
            <div className="mx-auto mt-6 max-w-xs space-y-3 text-left">
              <div className="space-y-1.5">
                <label htmlFor="mw-bank-name" className="text-xs font-medium">{t("onboarding.bankNameLabel")}</label>
                <div className="flex items-center gap-2">
                  {bankLogo && (
                    <img src={bankLogo} alt="" className="size-9 shrink-0 rounded-md border bg-card object-contain p-0.5" onError={(e) => { e.currentTarget.style.display = "none" }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <BankNameCombobox
                      value={bankName}
                      autoFocus
                      onChange={(v) => { setBankName(v); if (!v) { setBankDomain(""); setBankLogo("") } }}
                      onSelectBrand={(b) => { setBankName(b.name); setBankDomain(b.domain); setBankLogo(b.logoUrl) }}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="mw-bank-balance" className="text-xs font-medium">{t("onboarding.bankBalanceLabel")}</label>
                <AmountField id="mw-bank-balance" value={bankBalance} onChange={setBankBalance} symbol={symbol} />
              </div>
            </div>
          </div>
        )}

        {sub === 2 && (
          <div className="text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Target className="size-7" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">
              {isBusiness ? t("onboarding.budgetQuestionBusiness") : t("onboarding.budgetQuestionPersonal")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.budgetHint")}</p>
            <div className="mx-auto mt-6 max-w-xs space-y-3 text-left">
              {isBusiness ? (
                <>
                  <AmountField value={companyAmt} onChange={setCompanyAmt} symbol={symbol} autoFocus />
                  <PeriodChips value={companyPeriod} onChange={setCompanyPeriod} />
                  {showDefault ? (
                    <div className="mt-2 space-y-2 rounded-xl border bg-card/50 p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
                      <p className="text-xs font-medium">{t("budget.default")}</p>
                      <AmountField value={defaultAmt} onChange={setDefaultAmt} symbol={symbol} />
                      <PeriodChips value={defaultPeriod} onChange={setDefaultPeriod} />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowDefault(true)}
                      className="pressable inline-flex items-center gap-1 text-xs font-medium text-primary"
                    >
                      <Plus className="size-3.5" /> {t("onboarding.addDefaultBudget")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <AmountField value={personalAmt} onChange={setPersonalAmt} symbol={symbol} autoFocus />
                  <PeriodChips value={personalPeriod} onChange={setPersonalPeriod} />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* actions */}
      <div className="mt-6 flex flex-col gap-2">
        <Button size="lg" className="h-12 w-full text-base" disabled={submitting} onClick={next}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : sub < SUBS - 1 ? t("onboarding.continue") : t("onboarding.finish")}
        </Button>
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} disabled={submitting} className="pressable inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {t("onboarding.back")}
          </button>
          <button type="button" onClick={() => void finish()} disabled={submitting} className="pressable text-sm text-muted-foreground hover:text-foreground">
            {t("onboarding.skipForNow")}
          </button>
        </div>
      </div>
    </section>
  )
}
