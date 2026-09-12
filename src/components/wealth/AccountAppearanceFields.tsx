import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, Sparkles } from "lucide-react"
import {
  ACCOUNT_SWATCHES,
  accountAppearance,
  type AccountColorSource,
  type AccountColorStyle,
} from "@/lib/account-color"
import { isHexColor, normalizeHex } from "@/lib/cards"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import "@/components/wealth/account-color.css"

export type AppearanceValue = { color: string; color_style: AccountColorStyle }

/**
 * The colour field of an account form (bank create/edit, Cash edit, Space
 * create/edit).
 *
 * It is ONE field, the same size and weight as the Logo/icon select beside it.
 * A colour is a smaller decision than the opening balance, and the first
 * version — a bordered panel holding a swatch grid, a style toggle and a live
 * preview, all permanently open — shouted louder than the money on the same
 * form. Everything now lives behind the swatch: the trigger says what the
 * account will look like, the popover is where you change it.
 *
 * "Auto" stays a first-class choice, not an empty state: it is what a
 * brand-new account already looks like (the bank's own colour, else a stable
 * swatch), so getting back to it is one tap.
 */
export function AccountAppearanceFields({
  value,
  onChange,
  /** The account being edited — AUTO resolves against its brand/type/id. */
  account,
}: {
  value: AppearanceValue
  onChange: (patch: Partial<AppearanceValue>) => void
  account: AccountColorSource
}) {
  const { t } = useTranslation("wealth")
  const customId = useId()
  const [open, setOpen] = useState(false)
  const appearance = accountAppearance({ ...account, color: value.color, color_style: value.color_style })
  const isAuto = !isHexColor(value.color)
  // The custom well always shows a real colour to open the OS picker on.
  const customValue = isHexColor(value.color) ? normalizeHex(value.color) : appearance.hex
  const isPreset = !isAuto && ACCOUNT_SWATCHES.includes(normalizeHex(value.color))
  // Screen readers get the full sentence the visible chip conveys silently.
  const styleLabel = `${isAuto ? t("appearance.auto") : t("appearance.custom")} · ${
    value.color_style === "bold" ? t("appearance.bold") : t("appearance.subtle")
  }`

  return (
    <div className="space-y-1.5">
      <Label>{t("appearance.color")}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`${t("appearance.color")}: ${styleLabel}`}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow]",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {/* The chip is the tile in miniature — it carries the colour AND
                the style, so the label stays one short word and no locale
                ends up with "Custom colo…" in a half-width field. */}
            <span
              style={appearance.vars as React.CSSProperties}
              className={cn(
                "acct-colored relative h-4 w-6 shrink-0 overflow-hidden rounded-sm border",
                appearance.bold ? "acct-bold" : "acct-subtle acct-rail bg-card",
              )}
              aria-hidden
            />
            <span className="truncate">{isAuto ? t("appearance.auto") : t("appearance.customShort")}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-3 p-3">
          {/* Small rectangles in a tidy grid, not big dots: twelve colours read
              as a palette at a glance instead of a row of buttons. */}
          <div className="grid grid-cols-6 gap-1.5">
            {ACCOUNT_SWATCHES.map((hex) => {
              const selected = !isAuto && normalizeHex(value.color) === hex
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onChange({ color: hex })}
                  aria-label={hex}
                  aria-pressed={selected}
                  data-selected={selected}
                  style={{ "--acct-swatch": hex } as React.CSSProperties}
                  className="acct-swatch ios-tap flex h-7 w-full items-center justify-center rounded transition-transform hover:scale-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  {selected && <Check className="size-3.5 text-white drop-shadow" aria-hidden />}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ color: "" })}
              aria-pressed={isAuto}
              title={t("appearance.autoHint")}
              className={cn(
                "ios-tap inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border text-xs font-medium transition-colors",
                isAuto ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Sparkles className="size-3.5" aria-hidden /> {t("appearance.auto")}
            </button>

            {/* Anything outside the palette. The native well is the picker; the
                label around it is the clickable target. */}
            <Label
              htmlFor={customId}
              title={t("appearance.custom")}
              className={cn(
                "ios-tap flex h-8 w-14 cursor-pointer items-center justify-center rounded border border-dashed transition-colors hover:bg-muted",
                !isAuto && !isPreset && "border-solid border-primary",
              )}
              style={!isAuto && !isPreset ? { background: customValue } : undefined}
            >
              <span className="sr-only">{t("appearance.custom")}</span>
              {(isAuto || isPreset) && <span className="size-3.5 rounded-full bg-[conic-gradient(#DC2626,#CA8A04,#059669,#2563EB,#9333EA,#DC2626)]" aria-hidden />}
              <input
                id={customId}
                type="color"
                value={customValue}
                onChange={(e) => onChange({ color: normalizeHex(e.target.value) })}
                className="sr-only"
              />
            </Label>
          </div>

          {/* Subtle vs Bold means nothing as words, so each option is drawn in
              the colour it would actually paint — the preview IS the choice. */}
          <div className="grid grid-cols-2 gap-2">
            {(["subtle", "bold"] as const).map((style) => {
              const look = accountAppearance({ ...account, color: value.color, color_style: style })
              const active = value.color_style === style
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => onChange({ color_style: style })}
                  aria-pressed={active}
                  className={cn(
                    "ios-tap rounded-lg p-0.5 transition-colors",
                    active ? "ring-2 ring-primary" : "hover:bg-muted",
                  )}
                >
                  <span
                    style={look.vars as React.CSSProperties}
                    className={cn(
                      "acct-colored relative flex min-h-10 items-center overflow-hidden rounded-md border px-2.5 text-xs font-medium",
                      look.bold ? "acct-bold" : "acct-subtle acct-rail bg-card",
                      look.bold && (look.text === "light" ? "text-white" : "text-slate-900"),
                    )}
                  >
                    {style === "subtle" ? t("appearance.subtle") : t("appearance.bold")}
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
