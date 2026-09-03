import { useTranslation } from "react-i18next"
import type { BudgetSectionName } from "@/lib/types"
import { ENVELOPE_ICONS, envelopeIcon } from "@/components/budget/envelope-icons"

/**
 * A grid picker.
 *
 * A grid rather than a dropdown because picking a picture from a list of names
 * is the wrong interaction — you recognise the glyph, so show the glyphs.
 * Includes an explicit "no icon" cell, since the section fallback is a perfectly
 * good answer and forcing a choice here would be noise.
 */
export function EnvelopeIconPicker({
  value,
  section,
  onChange,
  label,
  clearLabel,
}: {
  value: string
  section: BudgetSectionName
  onChange: (icon: string) => void
  label: string
  clearLabel: string
}) {
  const { t } = useTranslation()
  const Fallback = envelopeIcon("", section)
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        aria-label={clearLabel}
        title={clearLabel}
        onClick={() => onChange("")}
        className={`pressable flex size-10 items-center justify-center rounded-lg border transition-colors ${
          !value ? "border-primary bg-primary/10" : "hover:bg-accent"
        }`}
      >
        <Fallback className="size-4 text-muted-foreground" aria-hidden />
      </button>
      {ENVELOPE_ICONS.map(({ key, Icon, labelKey }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={t(labelKey)}
          title={t(labelKey)}
          onClick={() => onChange(key)}
          className={`pressable flex size-10 items-center justify-center rounded-lg border transition-colors ${
            value === key ? "border-primary bg-primary/10" : "hover:bg-accent"
          }`}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}
