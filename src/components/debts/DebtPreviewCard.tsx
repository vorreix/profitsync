import { useTranslation } from "react-i18next"
import { Sparkles, TriangleAlert } from "lucide-react"
import { fromCents } from "@/lib/debt-math"
import type { DebtPreview } from "@/lib/debt-preview"
import { formatLongDate } from "@/lib/debt-format"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"

/**
 * What the debt being typed will actually DO, shown while it can still be
 * changed.
 *
 * The numbers that matter on a debt are not the ones you enter. Nobody types
 * "this costs me €22 of interest and ends in April"; they type an amount, a rate
 * and an instalment, and those three decide it. Everything here is derived
 * (src/lib/debt-preview.ts) and nothing is stored — which the note says out
 * loud, because a card full of confident figures on a form that has not been
 * submitted otherwise reads like a record of something that happened.
 */
export function DebtPreviewCard({
  preview,
  currency,
  receivable,
  frequencyWord,
  arriving,
}: {
  preview: DebtPreview
  currency: string
  receivable: boolean
  /** "month", "week" … for the instalment line. */
  frequencyWord: string
  /** The money landing in an account on save, when the user asked for that. */
  arriving: { amount: number; accountName: string } | null
}) {
  const { t } = useTranslation("debts")
  const money = (n: number) => formatMoney(n, currency, true)
  if (preview.kind === "empty") return null

  const warn = preview.kind === "never" || preview.kind === "too_long"

  return (
    <section
      aria-label={t("previewTitle")}
      className={cn(
        "space-y-2.5 rounded-xl border p-3",
        warn ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5",
      )}
    >
      <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", warn ? "text-amber-700 dark:text-amber-300" : "text-primary")}>
        {warn ? <TriangleAlert className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
        {t("previewTitle")}
      </p>

      {preview.kind === "schedule" && (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <Row label={receivable ? t("previewRepaidToYouBy") : t("previewPaidOffBy")} value={formatLongDate(preview.payoffDate)} strong />
            <Row label={t("previewPayments")} value={t("previewPaymentsValue", { count: preview.payments, amount: money(fromCents(preview.perPayment)) })} />
            <Row label={t("previewInterest")} value={money(fromCents(preview.totalInterest))} />
            <Row label={receivable ? t("previewTotalIn") : t("previewTotalOut")} value={money(fromCents(preview.totalPaid))} strong />
          </dl>
          <p className="text-xs text-muted-foreground">
            {preview.payments > 1 && preview.finalPayment !== preview.perPayment && `${t("previewFinal", { amount: money(fromCents(preview.finalPayment)) })} `}
            {preview.assumedZeroRate && `${t("previewAssumedZero")} `}
          </p>
        </>
      )}

      {preview.kind === "manual" && (
        <p className="text-sm">
          {receivable ? t("previewManualIn", { amount: money(fromCents(preview.owed)) }) : t("previewManualOut", { amount: money(fromCents(preview.owed)) })}
          {preview.repaidPct !== null && ` ${t("previewRepaidPct", { pct: Math.round(preview.repaidPct) })}`}
          <span className="block pt-1 text-xs text-muted-foreground">{t("previewManualHint")}</span>
        </p>
      )}

      {preview.kind === "never" && (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {t("previewNever", { amount: money(fromCents(preview.perPayment)), frequency: frequencyWord })}
          <span className="block pt-1 text-xs">{t("previewNeverMin", { amount: money(fromCents(preview.minimumPayment)) })}</span>
        </p>
      )}

      {preview.kind === "too_long" && (
        <p className="text-sm text-amber-800 dark:text-amber-200">{t("previewTooLong", { years: preview.years })}</p>
      )}

      {arriving && arriving.amount > 0 && (
        <p className="border-t border-current/10 pt-2 text-xs text-muted-foreground">
          {receivable
            ? t("previewLeaves", { amount: money(arriving.amount), account: arriving.accountName })
            : t("previewArrives", { amount: money(arriving.amount), account: arriving.accountName })}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">{t("previewNote")}</p>
    </section>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate tabular-nums", strong ? "font-semibold" : "font-medium")}>{value}</dd>
    </div>
  )
}
