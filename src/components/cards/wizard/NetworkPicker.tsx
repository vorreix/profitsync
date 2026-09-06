import type { KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { NETWORK_LABEL } from "@/lib/cards"
import type { CardNetwork } from "@/lib/types"
import { cn } from "@/lib/utils"
import { NetworkMark } from "@/components/cards/NetworkMark"

// Most common first; "other" last.
const ORDER: readonly CardNetwork[] = ["visa", "mastercard", "amex", "rupay", "maestro", "discover", "jcb", "unionpay", "diners", "other"]

/**
 * Network chips — each shows the network's mark on a tiny dark card so the
 * white wordmarks read in both themes, plus the name as text (never the mark
 * alone). A radiogroup with roving focus and arrow keys.
 */
export function NetworkPicker({ value, onChange }: { value: CardNetwork; onChange: (network: CardNetwork) => void }) {
  const { t } = useTranslation("wealth")
  const label = (n: CardNetwork) => (n === "other" ? t("cardWizard.network.other") : NETWORK_LABEL[n])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = ORDER.indexOf(value)
    const next = ORDER[(i + dir + ORDER.length) % ORDER.length]
    onChange(next)
    const el = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-network="${next}"]`)
    el?.focus()
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id="card-network-label">{t("cardWizard.network.label")}</p>
      <div role="radiogroup" aria-labelledby="card-network-label" className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
        {ORDER.map((n) => {
          const selected = value === n
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-network={n}
              onClick={() => onChange(n)}
              className={cn(
                "pressable ios-tap flex min-h-11 items-center gap-2 rounded-full border ps-1.5 pe-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected ? "border-primary/60 bg-primary/5 font-medium ring-1 ring-primary/30" : "hover:bg-muted/50",
              )}
            >
              <span aria-hidden className="flex h-7 w-11 shrink-0 items-center justify-center rounded-[5px] bg-slate-900 dark:bg-slate-800">
                <NetworkMark network={n} tone="light" className="h-3.5" />
              </span>
              <span>{label(n)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
