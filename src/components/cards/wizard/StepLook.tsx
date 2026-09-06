import { useTranslation } from "react-i18next"
import type { Card, CardWizardModeProps, WealthAccount } from "./step-types"
import { customTextUnreadable, tierSwatch, wizardBankName, type CardWizardField } from "@/lib/card-wizard"
import type { CardTier } from "@/lib/types"
import { TierPicker } from "./TierPicker"

/**
 * Step 2 — how the card looks. Optional: Standard (the bank's colours) is
 * preselected, so Next is always a valid answer.
 */
export function StepLook({
  form,
  onChange,
  selectedBank,
  savedCard,
  errors,
}: CardWizardModeProps & {
  selectedBank: WealthAccount | null
  savedCard?: Card | null
  errors: Partial<Record<CardWizardField, string>>
}) {
  const { t } = useTranslation("wealth")
  const bankName = wizardBankName(form, selectedBank)
  const brandKnown = form.kind === "credit" ? !!form.issuer_domain : !!selectedBank?.brand_domain
  const note =
    form.tier === "standard"
      ? brandKnown && bankName
        ? t("cardWizard.look.usingBankColours", { bank: bankName })
        : t("cardWizard.look.usingDefault")
      : t("cardWizard.look.help")

  return (
    <div className="space-y-4">
      <TierPicker
        value={form.tier}
        onChange={(tier: CardTier) => onChange({ tier })}
        swatchFor={(tier) => tierSwatch(tier, form, selectedBank, savedCard)}
        design={form.design}
        onDesignChange={(patch) => onChange({ design: { ...form.design, ...patch } })}
        textAuto={form.design_text_auto}
        onTextAutoChange={(auto) => onChange({ design_text_auto: auto })}
        unreadable={customTextUnreadable(form)}
      />
      {errors.design ? (
        <p role="alert" className="text-xs text-destructive">{errors.design}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{note}</p>
      )}
    </div>
  )
}
