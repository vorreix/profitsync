import { useTranslation } from "react-i18next"
import { formatExpiryInput } from "@/lib/card-wizard"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * One masked "MM/YY" field (the way every checkout does it): digits only, the
 * slash appears by itself, a lone 2–9 becomes "0X/". Left-to-right even in RTL
 * locales — an expiry is a number, not prose.
 */
export function ExpiryInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  className,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  invalid?: boolean
  describedBy?: string
  className?: string
}) {
  const { t } = useTranslation("wealth")
  return (
    <Input
      id={id}
      value={value}
      dir="ltr"
      inputMode="numeric"
      autoComplete="cc-exp"
      placeholder={t("cardWizard.expiry.placeholder")}
      maxLength={5}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn("min-h-11 text-base tabular-nums", className)}
      onChange={(e) => onChange(formatExpiryInput(e.target.value, value))}
    />
  )
}
