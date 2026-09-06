import { useTranslation } from "react-i18next"
import type { CardWizardModeProps, WealthAccount } from "./step-types"
import type { CardKind } from "@/lib/types"
import type { CardWizardField } from "@/lib/card-wizard"
import { BankNameCombobox } from "@/components/wealth/BankNameCombobox"
import { BankPicker } from "./BankPicker"
import { KindChoice } from "./KindChoice"
import { StepHeading } from "./StepHeading"

/**
 * Step 1 — what the card is and where it lives. Two questions, nothing else:
 * debit or credit, then the bank it spends from (debit) or the bank that issued
 * it (credit). Everything printed on the plastic waits for step 2, so this step
 * fits on a phone without scrolling.
 *
 * Create-only: after a card exists neither answer can change.
 */
export function StepType({
  form,
  onChange,
  banks,
  currency,
  balancesVisible,
  errors,
  creditLocked,
  canAddBank,
  onQuotaHit,
  onBankCreated,
  ready = true,
}: CardWizardModeProps & {
  banks: WealthAccount[]
  currency: string
  balancesVisible: boolean
  errors: Partial<Record<CardWizardField, string>>
  creditLocked: boolean
  canAddBank: boolean
  onQuotaHit: (kind: "bank" | "credit_card") => void
  onBankCreated: (bank: WealthAccount) => void
  /** Banks + allowance loaded (gates the inline form's auto-expand). */
  ready?: boolean
}) {
  const { t } = useTranslation("wealth")
  const credit = form.kind === "credit"
  const setKind = (kind: CardKind) => onChange({ kind })

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <StepHeading id="card-kind-label" title={t("cardWizard.kind.label")} help={t("cardWizard.type.help")} />
        <KindChoice value={form.kind} onChange={setKind} labelId="card-kind-label" creditLocked={creditLocked} onLockedCredit={() => onQuotaHit("credit_card")} />
      </div>

      {credit ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" id="card-issuer-label">{t("cardWizard.issuer.label")}</p>
          <div className="flex items-start gap-2" role="group" aria-labelledby="card-issuer-label" aria-describedby={errors.issuer_name ? "card-issuer_name-error" : undefined} data-card-issuer>
            {form.issuer_logo_url && (
              <img src={form.issuer_logo_url} alt="" className="size-11 shrink-0 rounded-md border bg-card object-contain p-0.5" onError={(e) => { e.currentTarget.style.display = "none" }} />
            )}
            <div className="min-w-0 flex-1 [&_input]:min-h-11 [&_input]:text-base">
              <BankNameCombobox
                value={form.issuer_name}
                onChange={(name) => onChange({ issuer_name: name })}
                onSelectBrand={(b) => onChange({ issuer_name: b.name, issuer_domain: b.domain, issuer_logo_url: b.logoUrl })}
                placeholder={t("cardWizard.issuer.placeholder")}
              />
            </div>
          </div>
          {errors.issuer_name ? (
            <p id="card-issuer_name-error" role="alert" className="text-xs text-destructive">{errors.issuer_name}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("cardWizard.issuer.help")}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium" id="card-bank-label">{t("cardWizard.bank.which")}</p>
          <BankPicker
            banks={banks}
            value={form.account_id}
            onChange={(id) => onChange({ account_id: id, funding_account_id: form.funding_account_id || id })}
            currency={currency}
            balancesVisible={balancesVisible}
            labelId="card-bank-label"
            pickerKey="bank"
            canAddBank={canAddBank}
            onBankCreated={onBankCreated}
            onQuotaHit={() => onQuotaHit("bank")}
            autoExpandWhenEmpty
            emptyCopy={t("cardWizard.bank.addFirst")}
            invalid={!!errors.account_id}
            describedBy={errors.account_id ? "card-account_id-error" : undefined}
            ready={ready}
          />
          {errors.account_id && (
            <p id="card-account_id-error" role="alert" className="text-xs text-destructive">{errors.account_id}</p>
          )}
        </div>
      )}
    </div>
  )
}
