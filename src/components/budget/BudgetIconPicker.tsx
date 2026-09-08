import { useTranslation } from "react-i18next"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { BUDGET_ICONS } from "@/components/budget/budget-icons"

/**
 * A grid picker.
 *
 * A grid rather than a dropdown because picking a picture from a list of names
 * is the wrong interaction — you recognise the glyph, so show the glyphs. The
 * first cell is "no icon": the money bag is a perfectly good answer and forcing
 * a choice here would be noise.
 */
export function BudgetIconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const { t } = useTranslation()
  const cell = (selected: boolean) =>
    `pressable flex size-11 items-center justify-center rounded-lg border transition-colors ${selected ? "border-primary bg-primary/10" : "hover:bg-accent"}`
  return (
    <div role="radiogroup" aria-label={t("budgets.dialog.iconLabel")} className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
      <button type="button" role="radio" aria-checked={!value} aria-label={t("budgets.dialog.noIcon")} title={t("budgets.dialog.noIcon")} onClick={() => onChange("")} className={cell(!value)}>
        <MoneyBag className="size-4 text-muted-foreground" aria-hidden />
      </button>
      {BUDGET_ICONS.map(({ key, Icon, labelKey }) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={t(labelKey)} title={t(labelKey)} onClick={() => onChange(key)} className={cell(value === key)}>
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}
