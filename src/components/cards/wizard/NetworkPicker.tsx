import { useEffect, useRef, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { NETWORK_LABEL } from "@/lib/cards"
import type { CardNetwork } from "@/lib/types"
import { cn } from "@/lib/utils"
import { NetworkMark } from "@/components/cards/NetworkMark"

// Most common first; "other" last.
const ORDER: readonly CardNetwork[] = ["visa", "mastercard", "amex", "rupay", "maestro", "discover", "jcb", "unionpay", "diners", "other"]

// Chip-sized names (brands, so not translated — "other" is, below).
const SHORT: Partial<Record<CardNetwork, string>> = { amex: "Amex", diners: "Diners" }

/**
 * Network chips on a single scroll rail — each shows the network's mark on a
 * tiny dark card so the white wordmarks read in both themes, plus the name as
 * text (never the mark alone). Ten wrapped chips used to eat five rows of a
 * phone screen; one snap rail costs one.
 *
 * A radiogroup with roving focus and arrow keys. Nothing is preselected: the
 * network is part of what makes a card recognisable, so the user picks it.
 */
export function NetworkPicker({
  value,
  onChange,
  labelId,
  invalid,
  describedBy,
}: {
  value: CardNetwork | ""
  onChange: (network: CardNetwork) => void
  labelId: string
  invalid?: boolean
  describedBy?: string
}) {
  const { t } = useTranslation("wealth")
  const railRef = useRef<HTMLDivElement>(null)
  const label = (n: CardNetwork) => (n === "other" ? t("cardWizard.network.other") : SHORT[n] ?? NETWORK_LABEL[n])

  // Editing an Amex? Its chip is off-screen on a phone until we bring it in.
  useEffect(() => {
    if (!value) return
    railRef.current?.querySelector<HTMLElement>(`[data-network="${value}"]`)?.scrollIntoView({ block: "nearest", inline: "center" })
    // Only on mount / when the saved card changes the selection from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = value ? ORDER.indexOf(value) : -1
    const next = i < 0 ? ORDER[dir > 0 ? 0 : ORDER.length - 1] : ORDER[(i + dir + ORDER.length) % ORDER.length]
    onChange(next)
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-network="${next}"]`)
    el?.focus()
    el?.scrollIntoView({ block: "nearest", inline: "center" })
  }

  return (
    <div
      ref={railRef}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      data-network-rail
      className={cn("-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin", invalid && "rounded-xl ring-1 ring-destructive/40")}
      onKeyDown={onKeyDown}
    >
      {ORDER.map((n, i) => {
        const selected = value === n
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!value && i === 0) ? 0 : -1}
            data-network={n}
            onClick={() => onChange(n)}
            className={cn(
              "pressable ios-tap flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border ps-1.5 pe-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              selected ? "border-primary/60 bg-primary/5 font-medium ring-1 ring-primary/30" : "hover:bg-muted/50",
            )}
          >
            <span aria-hidden className="flex h-7 w-10 shrink-0 items-center justify-center rounded-[5px] bg-slate-900 dark:bg-slate-800">
              <NetworkMark network={n} tone="light" className="h-3" />
            </span>
            <span className="whitespace-nowrap">{label(n)}</span>
          </button>
        )
      })}
    </div>
  )
}
