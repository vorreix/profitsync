import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, CreditCard, Info, Zap } from "lucide-react"
import { apiErrorMessage, apiPatch } from "@/lib/api"
import { isLiabilityType } from "@/lib/credit-card"
import type { Card, CardSummary, WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { shortDate } from "@/components/cards/card-dates"

/**
 * Autopay for a credit card — OPT-IN, and only a mirror: when the user's bank
 * really pays the statement on the due date, ProfitSync records that transfer
 * (funding bank → card) so the books match. The panel is the whole control
 * surface: the switch, the paying bank, what pays next, what happened last,
 * and any statement autopay will never touch (due before it was switched on).
 */
export function AutopayPanel({
  card,
  summary,
  accounts,
  currency,
  balancesVisible,
  canWrite,
  onChanged,
  onPayManually,
}: {
  card: Card
  summary: CardSummary | null
  accounts: WealthAccount[]
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  onChanged: (card: Card) => void
  onPayManually: () => void
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const money = (n: number) => formatMoney(n, currency, balancesVisible)
  // Where an AUTOMATIC payment comes from: money the user holds (banks + cash),
  // never a card or a Space, and never the card's own liability account. A card
  // CAN pay this one (a balance transfer, set in the wizard or the Pay sheet) —
  // but never on a schedule, so it is not offered here. The server refuses the
  // combination too (api/_lib/card-autopay.ts).
  const sources = useMemo(
    () => accounts.filter((a) => !a.archived_at && a.id !== card.account_id && !isLiabilityType(a.type) && a.type !== "space"),
    [accounts, card.account_id],
  )

  // Optimistic mirror of the card's autopay fields (rolled back on failure).
  const [on, setOn] = useState(card.autopay)
  const [funding, setFunding] = useState(card.funding_account_id ?? "")
  const [busy, setBusy] = useState(false)
  useEffect(() => { setOn(card.autopay); setFunding(card.funding_account_id ?? "") }, [card.id, card.autopay, card.funding_account_id])

  async function patch(body: Record<string, unknown>, rollback: () => void) {
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<Card>(`/api/cards/${card.id}`, token, body)
      toast.success(t("cards.autopayUpdated"))
      onChanged(updated)
    } catch (err) {
      rollback()
      toast.error(apiErrorMessage(err, t("cards.updateFailed")))
    } finally {
      setBusy(false)
    }
  }

  function toggle(next: boolean) {
    const prev = on
    setOn(next)
    void patch({ autopay: next }, () => setOn(prev))
  }

  function changeBank(id: string) {
    const prev = funding
    setFunding(id)
    void patch({ funding_account_id: id || null }, () => setFunding(prev))
  }

  const next = summary?.next_autopay ?? null
  const last = summary?.last_autopay ?? null
  const fundingName = sources.find((a) => a.id === funding)
  // Statements autopay will never pay: still owed and due on/before the day it
  // was switched on (they may already be paid at the bank — the user decides).
  const notCovered = useMemo(() => {
    if (!on || !summary?.credit) return []
    const all = [summary.credit.statement, ...summary.credit.history].filter((s): s is NonNullable<typeof s> => !!s)
    return all.filter((s) => s.remaining > 0 && !!card.autopay_since && s.due_date <= card.autopay_since)
  }, [on, summary, card.autopay_since])

  return (
    <section aria-labelledby="autopay-heading" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
            <Zap className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="autopay-heading" className="text-sm font-semibold">{t("cards.autopay")}</h2>
            <p className="text-xs text-muted-foreground">
              {on
                ? next
                  ? t("cards.autopayNext", { date: shortDate(next.date), amount: money(next.amount) })
                  : t("cards.autopayNothingScheduled")
                : t("cards.autopayOff")}
            </p>
          </div>
        </div>
        <div className="flex min-h-11 items-center">
          <Switch
            checked={on}
            onCheckedChange={toggle}
            disabled={!canWrite || busy || (!on && !funding)}
            aria-label={t("cards.autopay")}
            className="scale-125"
          />
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("cards.autopayHelp")}
      </p>

      <div className="mt-4 space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("cards.autopayPayingBank")}</Label>
        <AccountCombobox
          accounts={sources}
          value={funding}
          onChange={changeBank}
          currency={currency}
          balancesVisible={balancesVisible}
          disabled={!canWrite || busy}
          allowNone
          noneLabel={t("cards.noPayingBank")}
        />
        {!funding && <p className="text-xs text-muted-foreground">{t("cards.autopayChooseBank")}</p>}
        {funding && !fundingName && <p className="text-xs text-muted-foreground">{t("cards.noPayingBank")}</p>}
      </div>

      {last && (
        <p className={cn("mt-3 flex items-start gap-1.5 text-xs", last.status === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
          {last.status === "failed" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>
            {last.status === "paid" && t("cards.autopayLastPaid", { date: last.at ? shortDate(last.at) : "—" })}
            {last.status === "skipped" && t("cards.autopayLastSkipped", { date: last.at ? shortDate(last.at) : "—" })}
            {last.status === "failed" && t("cards.autopayLastFailed", { date: last.at ? shortDate(last.at) : "—" })}
          </span>
          {last.status === "failed" && canWrite && (
            <Button size="xs" variant="outline" className="ms-auto shrink-0" onClick={onPayManually}>
              <CreditCard className="size-3" /> {t("cards.autopayPayManually")}
            </Button>
          )}
        </p>
      )}

      {notCovered.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {notCovered.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              <span className="tabular-nums">{t("dueOn", { date: shortDate(s.due_date) })} · {t("statementRemaining", { amount: money(s.remaining) })}</span>
              <span className="basis-full sm:basis-auto">{t("cards.autopayNotCovered")}</span>
              {canWrite && (
                <Button size="xs" variant="outline" className="ms-auto shrink-0" onClick={onPayManually}>
                  <CreditCard className="size-3" /> {t("cards.autopayPayManually")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
