import type { KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Palette } from "lucide-react"
import { CARD_PATTERNS, CARD_TIERS, normalizeHex } from "@/lib/cards"
import type { CardDesign, CardPattern, CardTier } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

type TextChoice = "auto" | "light" | "dark"

/**
 * The card's look: a row of swatches — Standard wears the bank's colours,
 * gold / platinum / metal / black are fixed finishes, Custom opens two colour
 * pickers, a text-colour choice (Auto follows the colours) and a pattern.
 * Every option is a radio with a text label; colour is never the only cue.
 */
export function TierPicker({
  value,
  onChange,
  labelId,
  swatchFor,
  design,
  onDesignChange,
  textAuto,
  onTextAutoChange,
  unreadable,
}: {
  value: CardTier
  onChange: (tier: CardTier) => void
  /** id of the heading that asks the question (the step's own heading). */
  labelId: string
  swatchFor: (tier: CardTier) => { from: string; to: string }
  design: CardDesign
  onDesignChange: (patch: Partial<CardDesign>) => void
  textAuto: boolean
  onTextAutoChange: (auto: boolean) => void
  /** The user forced a text colour the background cannot carry. */
  unreadable: boolean
}) {
  const { t } = useTranslation("wealth")
  const tierLabel = (tier: CardTier) => t(`cardWizard.look.tiers.${tier}`)
  const gradient = (s: { from: string; to: string }) => `linear-gradient(135deg, ${s.from} 0%, ${s.to} 100%)`

  const onTierKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = CARD_TIERS.indexOf(value)
    const next = CARD_TIERS[(i + dir + CARD_TIERS.length) % CARD_TIERS.length]
    onChange(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tier="${next}"]`)?.focus()
  }

  const textChoice: TextChoice = textAuto ? "auto" : design.text
  const textOptions: { key: TextChoice; label: string }[] = [
    { key: "auto", label: t("cardWizard.look.textAuto") },
    { key: "light", label: t("cardWizard.look.textLight") },
    { key: "dark", label: t("cardWizard.look.textDark") },
  ]
  const chooseText = (key: TextChoice) => {
    if (key === "auto") onTextAutoChange(true)
    else {
      onTextAutoChange(false)
      onDesignChange({ text: key })
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin"
          onKeyDown={onTierKey}
        >
          {CARD_TIERS.map((tier) => {
            const selected = value === tier
            const s = swatchFor(tier)
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-tier={tier}
                onClick={() => onChange(tier)}
                className={cn(
                  "pressable ios-tap flex min-h-11 w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-9 w-14 items-center justify-center rounded-md shadow-inner ring-1 ring-black/10 dark:ring-white/10"
                  style={{ background: gradient(s) }}
                >
                  {tier === "custom" && <Palette className="size-4 text-white/90 drop-shadow" />}
                </span>
                <span className={cn("text-[11px] leading-tight", selected ? "font-medium" : "text-muted-foreground")}>{tierLabel(tier)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {value === "custom" && (
        <div className="space-y-4 rounded-xl border bg-muted/20 p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
          <div className="grid grid-cols-2 gap-3">
            <ColorField id="card-color-from" label={t("cardWizard.look.from")} value={design.from} onChange={(from) => onDesignChange({ from })} />
            <ColorField id="card-color-to" label={t("cardWizard.look.to")} value={design.to} onChange={(to) => onDesignChange({ to })} />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground" id="card-text-label">{t("cardWizard.look.text")}</p>
            <div role="radiogroup" aria-labelledby="card-text-label" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {textOptions.map((o) => {
                const selected = textChoice === o.key
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => chooseText(o.key)}
                    className={cn(
                      "ios-tap min-h-9 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            {unreadable && (
              <p role="status" className="flex items-start gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("cardWizard.look.unreadable")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground" id="card-pattern-label">{t("cardWizard.look.pattern")}</p>
            <div role="radiogroup" aria-labelledby="card-pattern-label" className="flex flex-wrap gap-2">
              {CARD_PATTERNS.map((p: CardPattern) => {
                const selected = design.pattern === p
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onDesignChange({ pattern: p })}
                    className={cn(
                      "pressable ios-tap min-h-10 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected ? "border-primary/60 bg-primary/5 font-medium ring-1 ring-primary/30" : "hover:bg-muted/50",
                    )}
                  >
                    {t(`cardWizard.look.patterns.${p}`)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A native colour input styled as a 44px swatch with its hex beside it. */
function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (hex: string) => void }) {
  const hex = normalizeHex(value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
        <input
          id={id}
          type="color"
          value={hex.toLowerCase()}
          onChange={(e) => onChange(normalizeHex(e.target.value))}
          className="size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0"
        />
        <span className="font-mono text-sm uppercase tabular-nums" dir="ltr">{hex}</span>
      </label>
    </div>
  )
}
