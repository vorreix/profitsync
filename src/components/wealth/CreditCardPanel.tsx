import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, ChevronDown, CreditCard, Pencil, Plus, RotateCcw, Receipt, SlidersHorizontal } from "lucide-react"
import type { CreditCardStatementView, CreditCardSummary, WealthAccount } from "@/lib/types"
import { creditUsage } from "@/lib/credit-card"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

const formatDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })

/**
 * Textual status for a statement — the words carry the meaning, the colour only
 * reinforces it (accessibility: never colour alone).
 */
export function StatementStatusBadge({ status }: { status: CreditCardStatementView["status"] }) {
  const { t } = useTranslation("wealth")
  const map = {
    paid: { label: t("statusPaid"), className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    partial: { label: t("statusPartial"), className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
    unpaid: { label: t("statusUnpaid"), className: "border-border bg-muted text-foreground" },
    overdue: { label: t("statusOverdue"), className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  }[status]
  return (
    <Badge variant="outline" className={cn("gap-1 py-0 text-[11px]", map.className)}>
      {status === "overdue" && <AlertTriangle className="size-3" aria-hidden />}
      {map.label}
    </Badge>
  )
}

/**
 * The credit-card view of an account: what you owe, how much of the limit is
 * left, the latest statement (due / paid / remaining, with a textual status),
 * the open cycle's new spending, and the Pay-card action. Every number comes
 * from GET /api/wealth/accounts/:id/card (ledger-derived); nothing here does
 * liability arithmetic — see src/lib/credit-card.ts.
 */
export function CreditCardPanel({
  account,
  summary,
  currency,
  balancesVisible,
  canWrite,
  onPay,
  onAdjust,
  onAddPurchase,
  onAddRefund,
  onAddFee,
  embedded = false,
  frozen = false,
  frozenHint,
  extraActions,
}: {
  account: WealthAccount
  summary: CreditCardSummary | null
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  onPay: (preset: "statement" | "full" | "other") => void
  onAdjust: () => void
  onAddPurchase: () => void
  onAddRefund: () => void
  onAddFee: () => void
  /** Under a card visual (the card page): a flat surface instead of the hero gradient. */
  embedded?: boolean
  /** A frozen card takes no new purchases/refunds/fees — paying it stays allowed. */
  frozen?: boolean
  frozenHint?: string
  /** Extra buttons in the actions row (e.g. "Add recurring"). */
  extraActions?: ReactNode
}) {
  const { t } = useTranslation("wealth")
  const [historyOpen, setHistoryOpen] = useState(false)
  // The headline figures fall back to the account row while the summary loads —
  // same math, so the number never "jumps" when the summary arrives.
  const usage = summary?.usage ?? creditUsage(account.credit_limit, account.current_balance)
  const money = (n: number) => formatMoney(n, currency, balancesVisible)
  const statement = summary?.statement ?? null
  const cycle = summary?.cycle ?? null
  const canPaySomething = usage.debt > 0

  return (
    <div className="space-y-4">
      {/* Amount owed + credit usage */}
      <div className={cn("rounded-2xl border p-5 sm:p-6", embedded ? "bg-card" : "bg-gradient-to-br from-primary/10 via-card to-card")}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {usage.debt > 0 || usage.credit === 0 ? t("amountOwed") : t("creditCard")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-3xl font-bold tabular-nums sm:text-4xl">
            {usage.debt > 0
              ? money(usage.debt)
              : usage.credit > 0
                ? t("cardCredit", { amount: money(usage.credit) })
                : money(0)}
          </p>
          {canWrite && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("adjust")}
              title={t("adjust")}
              onClick={onAdjust}
            >
              <SlidersHorizontal className="size-4" />
            </Button>
          )}
          {usage.overLimit && (
            <Badge variant="outline" className="gap-1 border-red-500/40 bg-red-500/10 py-0 text-[11px] text-red-700 dark:text-red-300">
              <AlertTriangle className="size-3" aria-hidden /> {t("overLimit")}
            </Badge>
          )}
        </div>

        {usage.limit !== null && usage.available !== null && (
          <div className="mt-4 space-y-1.5">
            <Progress
              value={Math.round((usage.utilization ?? 0) * 100)}
              aria-label={t("availableCredit")}
              aria-valuetext={t("availableOf", { available: money(usage.available), limit: money(usage.limit) })}
              className={cn("h-2", usage.overLimit && "[&>div]:bg-red-500")}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{t("availableOf", { available: money(usage.available), limit: money(usage.limit) })}</span>
              {usage.utilization !== null && balancesVisible && (
                <span className="tabular-nums">{t("utilization", { pct: Math.round(usage.utilization * 100) })}</span>
              )}
            </div>
          </div>
        )}

        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onPay(statement && statement.remaining > 0 ? "statement" : "full")} disabled={!canPaySomething} className="pressable">
              <CreditCard className="size-4" /> {t("payCard")}
            </Button>
            <Button size="sm" variant="outline" onClick={onAddPurchase} className="pressable" disabled={frozen}>
              <Plus className="size-4" /> {t("addPurchase")}
            </Button>
            <Button size="sm" variant="outline" onClick={onAddRefund} className="pressable" disabled={frozen}>
              <RotateCcw className="size-4" /> {t("addRefund")}
            </Button>
            <Button size="sm" variant="outline" onClick={onAddFee} className="pressable" disabled={frozen}>
              <Receipt className="size-4" /> {t("addFee")}
            </Button>
            {extraActions}
          </div>
        )}
        {canWrite && frozen && frozenHint && <p className="mt-2 text-xs text-muted-foreground">{frozenHint}</p>}
      </div>

      {/* Statement + new cycle — two clearly labelled, different concepts */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="cc-statement-heading" className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="cc-statement-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("statement")}</h2>
            {statement && <StatementStatusBadge status={statement.status} />}
          </div>
          {!summary ? (
            <Skeleton className="mt-3 h-8 w-32" />
          ) : statement ? (
            <div className="mt-2 space-y-1">
              <p className="text-2xl font-bold tabular-nums">
                {statement.remaining > 0 ? t("statementDue", { amount: money(statement.remaining) }) : t("statusPaid")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("dueOn", { date: formatDate(statement.due_date) })}
                <span aria-hidden> · </span>
                {t("statementTotal", { amount: money(statement.statementBalance) })}
              </p>
              {statement.paid > 0 && statement.remaining > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t("statementPaidAmount", { amount: money(statement.paid) })}
                  <span aria-hidden> · </span>
                  {t("statementRemaining", { amount: money(statement.remaining) })}
                </p>
              )}
              {canWrite && statement.remaining > 0 && (
                <Button size="sm" variant="secondary" className="pressable mt-2" onClick={() => onPay("statement")}>
                  <CreditCard className="size-4" /> {t("payStatement")}
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium">{t("noStatementYet")}</p>
              {cycle && <p className="text-xs text-muted-foreground">{t("firstStatementOn", { date: formatDate(cycle.closes_on) })}</p>}
            </div>
          )}
        </section>

        <section aria-labelledby="cc-cycle-heading" className="rounded-2xl border bg-card p-4">
          <h2 id="cc-cycle-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("newCycle")}</h2>
          {!summary || !cycle ? (
            <Skeleton className="mt-3 h-8 w-32" />
          ) : (
            <div className="mt-2 space-y-1">
              <p className="text-2xl font-bold tabular-nums">{t("spentThisCycle", { amount: money(cycle.spent) })}</p>
              <p className="text-xs text-muted-foreground">{t("closesOn", { date: formatDate(cycle.closes_on) })}</p>
              {(cycle.refunds > 0 || cycle.payments > 0 || cycle.transfers_out > 0) && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {cycle.refunds > 0 && t("refundedThisCycle", { amount: money(cycle.refunds) })}
                  {cycle.refunds > 0 && cycle.payments > 0 && <span aria-hidden> · </span>}
                  {cycle.payments > 0 && t("paymentsThisCycle", { amount: money(cycle.payments) })}
                  {/* This card was used to pay another one. Not spending, but
                      the card owes for it, so the cycle must say so. */}
                  {(cycle.refunds > 0 || cycle.payments > 0) && cycle.transfers_out > 0 && <span aria-hidden> · </span>}
                  {cycle.transfers_out > 0 && t("movedToOtherCards", { amount: money(cycle.transfers_out) })}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Past statements */}
      {summary && summary.history.length > 0 && (
        <div className="rounded-2xl border bg-card">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls="cc-history"
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium"
          >
            <span>{t("statementHistory")} <span className="text-muted-foreground">({summary.history.length})</span></span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", historyOpen && "rotate-180")} />
          </button>
          <div id="cc-history" hidden={!historyOpen} className="divide-y border-t">
            {summary.history.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{money(s.statementBalance)}</p>
                  <p className="text-xs text-muted-foreground">{t("closedOn", { date: formatDate(s.closing_date) })} · {t("dueOn", { date: formatDate(s.due_date) })}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.remaining > 0 && <span className="text-xs tabular-nums text-muted-foreground">{t("statementRemaining", { amount: money(s.remaining) })}</span>}
                  <StatementStatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Pencil className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("payCardHelp")}
      </p>
    </div>
  )
}
