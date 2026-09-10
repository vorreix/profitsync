import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Check, Sparkles } from "lucide-react"
import {
  ACCOUNT_SWATCHES,
  accountAppearance,
  type AccountColorSource,
  type AccountColorStyle,
} from "@/lib/account-color"
import { isHexColor, normalizeHex } from "@/lib/cards"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import "@/components/wealth/account-color.css"

export type AppearanceValue = { color: string; color_style: AccountColorStyle }

/**
 * The Appearance block of every account form (bank create/edit, Cash edit,
 * Space create/edit): a colour and how loudly the tile wears it.
 *
 * "Auto" is a first-class choice, not an empty state — it is what a brand-new
 * account already looks like (the bank's own colour, else a stable swatch), so
 * clearing back to it must be one tap. The preview is the real tile treatment
 * at small scale, because "Subtle vs Bold" means nothing as words.
 */
export function AccountAppearanceFields({
  value,
  onChange,
  /** The account being edited — AUTO resolves against its brand/type/id. */
  account,
  /** Name shown in the preview (falls back to a placeholder while empty). */
  previewName,
}: {
  value: AppearanceValue
  onChange: (patch: Partial<AppearanceValue>) => void
  account: AccountColorSource
  previewName?: string
}) {
  const { t } = useTranslation("wealth")
  const customId = useId()
  const appearance = accountAppearance({ ...account, color: value.color, color_style: value.color_style })
  const isAuto = !isHexColor(value.color)
  // The custom well always shows a real colour to open the OS picker on.
  const customValue = isHexColor(value.color) ? normalizeHex(value.color) : appearance.hex
  const isPresetSelected = ACCOUNT_SWATCHES.some((hex) => hex === normalizeHex(value.color || "#000000")) && !isAuto

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("appearance.title")}</p>

      <div className="space-y-2">
        <Label className="text-xs font-normal text-muted-foreground">{t("appearance.color")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ color: "" })}
            aria-pressed={isAuto}
            title={t("appearance.autoHint")}
            className={cn(
              "ios-tap inline-flex h-11 min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
              isAuto ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Sparkles className="size-3.5" aria-hidden /> {t("appearance.auto")}
          </button>

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
                className="acct-swatch ios-tap flex size-11 min-h-11 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {selected && <Check className="size-5 text-white drop-shadow" aria-hidden />}
              </button>
            )
          })}

          {/* Anything outside the palette. The native well is the picker; the
              label around it is what carries the 44px touch target. */}
          <Label
            htmlFor={customId}
            title={t("appearance.custom")}
            className={cn(
              "ios-tap flex size-11 min-h-11 cursor-pointer items-center justify-center rounded-full border-2 border-dashed transition-colors hover:bg-muted",
              !isAuto && !isPresetSelected && "border-solid border-primary",
            )}
            style={!isAuto && !isPresetSelected ? { background: customValue } : undefined}
          >
            <span className="sr-only">{t("appearance.custom")}</span>
            {(isAuto || isPresetSelected) && <span className="size-5 rounded-full bg-[conic-gradient(#DC2626,#CA8A04,#059669,#2563EB,#9333EA,#DC2626)]" aria-hidden />}
            <input
              id={customId}
              type="color"
              value={customValue}
              onChange={(e) => onChange({ color: normalizeHex(e.target.value) })}
              className="sr-only"
            />
          </Label>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-normal text-muted-foreground">{t("appearance.style")}</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["subtle", "bold"] as const).map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => onChange({ color_style: style })}
              aria-pressed={value.color_style === style}
              className={cn(
                "ios-tap min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
                value.color_style === style ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {style === "subtle" ? t("appearance.subtle") : t("appearance.bold")}
            </button>
          ))}
        </div>
      </div>

      {/* Preview — the same treatment the real tile gets, one third the size. */}
      <div
        style={appearance.vars as React.CSSProperties}
        className={cn(
          "acct-colored relative overflow-hidden rounded-xl border p-3",
          appearance.bold ? "acct-bold" : "acct-subtle acct-rail bg-card",
        )}
      >
        <p className={cn("truncate text-xs font-semibold", appearance.bold && (appearance.text === "light" ? "text-white" : "text-slate-900"))}>
          {previewName?.trim() || t("appearance.preview")}
        </p>
        <p className={cn("mt-1 text-lg font-bold tabular-nums", appearance.bold ? (appearance.text === "light" ? "text-white" : "text-slate-900") : "text-foreground")}>
          1,234.00
        </p>
      </div>
    </div>
  )
}
