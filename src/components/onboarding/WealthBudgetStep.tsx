import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, Landmark, Loader as Loader2, Target, Wallet } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { BUDGET_PERIODS, type BudgetPeriod } from "@/lib/budget"
import type { AccountType, Client } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const PERIOD_KEY: Record<BudgetPeriod, string> = {
  lifetime: "budget.lifetime",
  monthly: "budget.monthly",
  weekly: "budget.weekly",
  daily: "budget.daily",
}

function PeriodSelect({ value, onChange }: { value: BudgetPeriod; onChange: (v: BudgetPeriod) => void }) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(v) => onChange(v as BudgetPeriod)}>
      <SelectTrigger className="h-11 w-32 shrink-0"><SelectValue /></SelectTrigger>
      <SelectContent>
        {BUDGET_PERIODS.map((p) => <SelectItem key={p} value={p}>{t(PERIOD_KEY[p])}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/**
 * Onboarding step 2 — optional starting balances + budgets. Everything is
 * best-effort: each create is fired independently and a failure (e.g. quota) is
 * non-blocking, so the user always reaches the plan step. The org already exists
 * (created in step 1), so we POST straight to the wealth + budget endpoints.
 * Bank accounts are gated to the FREE limit (1) server-side until the user upgrades.
 */
export function WealthBudgetStep({
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

  const [cash, setCash] = useState("")
  const [bankName, setBankName] = useState("")
  const [bankBalance, setBankBalance] = useState("")
  const [personalAmt, setPersonalAmt] = useState("")
  const [personalPeriod, setPersonalPeriod] = useState<BudgetPeriod>("monthly")
  const [companyAmt, setCompanyAmt] = useState("")
  const [companyPeriod, setCompanyPeriod] = useState<BudgetPeriod>("monthly")
  const [defaultAmt, setDefaultAmt] = useState("")
  const [defaultPeriod, setDefaultPeriod] = useState<BudgetPeriod>("monthly")
  const [ownClientId, setOwnClientId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Business: resolve the own/company client so the "company budget" attaches to it.
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
        /* non-blocking */
      }
    })()
    return () => { cancelled = true }
  }, [isBusiness, getToken])

  const submit = async () => {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) { onDone(); return }
      const tasks: Promise<unknown>[] = []
      const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

      const cashN = num(cash)
      if (cashN) tasks.push(apiPost("/api/wealth/accounts", token, { type: "cash", opening_balance: cashN }).catch(() => {}))
      if (bankName.trim()) {
        tasks.push(apiPost("/api/wealth/accounts", token, {
          type: "bank", bank_name: bankName.trim(), opening_balance: num(bankBalance) ?? 0,
        }).catch(() => {}))
      }
      const addBudget = (clientId: string | null, amt: string, period: BudgetPeriod) => {
        const n = num(amt)
        if (n) tasks.push(apiPost("/api/budgets", token, { client_id: clientId, amount: n, period }).catch(() => {}))
      }
      if (isBusiness) {
        if (ownClientId) addBudget(ownClientId, companyAmt, companyPeriod)
        addBudget(null, defaultAmt, defaultPeriod) // default for new clients
      } else {
        addBudget(null, personalAmt, personalPeriod)
      }

      await Promise.all(tasks)
      onDone()
    } catch {
      toast.error(t("budget.saveFailed"))
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-1 flex-col py-6 sm:py-8">
      <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
        <button type="button" onClick={onBack} className="pressable inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {t("onboarding.back")}
        </button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{t("onboarding.setupMoneyTitle")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{t("onboarding.setupMoneySubtitle")}</p>
      </div>

      <div className="mt-6 space-y-5">
        {/* Cash in hand */}
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Wallet className="size-4 text-muted-foreground" />{t("onboarding.balanceInHand")}</div>
          <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" className="mt-2 h-11" />
          <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.balanceInHandHint")}</p>
        </div>

        {/* Bank account (free = 1) */}
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Landmark className="size-4 text-muted-foreground" />{t("onboarding.bankAccountTitle")}</div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ob-bank-name" className="text-xs">{t("onboarding.bankNameLabel")}</Label>
              <Input id="ob-bank-name" value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-bank-balance" className="text-xs">{t("onboarding.bankBalanceLabel")}</Label>
              <Input id="ob-bank-balance" inputMode="decimal" value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} placeholder="0.00" className="h-11" />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("onboarding.freeBankNote")}</p>
        </div>

        {/* Budgets */}
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Target className="size-4 text-muted-foreground" />{t("onboarding.budgetsTitle")}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{currency}</p>
          {isBusiness ? (
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("budget.company")}</Label>
                <div className="flex gap-2">
                  <Input inputMode="decimal" value={companyAmt} onChange={(e) => setCompanyAmt(e.target.value)} placeholder="0.00" className="h-11" />
                  <PeriodSelect value={companyPeriod} onChange={setCompanyPeriod} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("budget.default")}</Label>
                <div className="flex gap-2">
                  <Input inputMode="decimal" value={defaultAmt} onChange={(e) => setDefaultAmt(e.target.value)} placeholder="0.00" className="h-11" />
                  <PeriodSelect value={defaultPeriod} onChange={setDefaultPeriod} />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs">{t("budget.personal")}</Label>
              <div className="flex gap-2">
                <Input inputMode="decimal" value={personalAmt} onChange={(e) => setPersonalAmt(e.target.value)} placeholder="0.00" className="h-11" />
                <PeriodSelect value={personalPeriod} onChange={setPersonalPeriod} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <Button size="lg" className="h-12 w-full text-base" disabled={saving} onClick={submit}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : t("onboarding.continue")}
        </Button>
        <button type="button" onClick={onDone} disabled={saving} className="pressable mx-auto text-sm text-muted-foreground hover:text-foreground">
          {t("onboarding.skipForNow")}
        </button>
      </div>
    </section>
  )
}
