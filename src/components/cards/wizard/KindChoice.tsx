import type { KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { Check, CreditCard, Crown, Landmark } from "lucide-react"
import type { CardKind } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Debit or credit, as two option cards with a one-line explanation each — the
 * only place the app has to explain the difference, so it does it in plain
 * words. A radiogroup labelled by the step's own heading ("What kind of card is
 * it?"): arrow keys switch, the choice is also a real button.
 *
 * When the plan's credit-card allowance is used up the Credit option wears the
 * crown and choosing it hands off to the upgrade prompt instead.
 */
export function KindChoice({
  value,
  onChange,
  labelId,
  creditLocked = false,
  onLockedCredit,
}: {
  value: CardKind
  onChange: (kind: CardKind) => void
  /** id of the heading that asks the question. */
  labelId: string
  creditLocked?: boolean
  onLockedCredit?: () => void
}) {
  const { t } = useTranslation("wealth")
  const options: { kind: CardKind; Icon: typeof Landmark; label: string; help: string }[] = [
    { kind: "debit", Icon: Landmark, label: t("cardWizard.kind.debit"), help: t("cardWizard.kind.debitHelp") },
    { kind: "credit", Icon: CreditCard, label: t("cardWizard.kind.credit"), help: t("cardWizard.kind.creditHelp") },
  ]

  const pick = (kind: CardKind) => {
    if (kind === value) return
    if (kind === "credit" && creditLocked) {
      onLockedCredit?.()
      return
    }
    onChange(kind)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
    e.preventDefault()
    pick(value === "debit" ? "credit" : "debit")
  }

  return (
    <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-2 gap-2" onKeyDown={onKeyDown}>
      {options.map(({ kind, Icon, label, help }) => {
        const selected = value === kind
        const locked = kind === "credit" && creditLocked
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-kind={kind}
            onClick={() => pick(kind)}
            className={cn(
              "pressable ios-tap flex min-h-[4.75rem] flex-col items-start gap-1.5 rounded-xl border p-3 text-start transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold">{label}</span>
              {locked ? (
                <Crown className="ms-auto size-4 shrink-0 text-amber-500 dark:text-amber-400" aria-label={t("cardWizard.kind.locked")} />
              ) : selected ? (
                <Check className="ms-auto size-4 shrink-0 text-primary" aria-hidden />
              ) : null}
            </span>
            <span className="text-xs leading-snug text-muted-foreground">{help}</span>
          </button>
        )
      })}
    </div>
  )
}
