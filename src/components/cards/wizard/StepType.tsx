import { useTranslation } from "react-i18next"
import type { CardWizardModeProps, WealthAccount } from "./step-types"
import type { CardKind } from "@/lib/types"
import type { CardWizardField } from "@/lib/card-wizard"
import { BankPicker } from "./BankPicker"
import { KindChoice } from "./KindChoice"
import { StepHeading } from "./StepHeading"

/**
 * Step 1 — what the card is and where it lives. Two questions, nothing else:
 * debit or credit, then the BANK — the one it spends from (debit) or the one
 * that issued it (credit). Both are a real account picked from the user's
 * banks, or created right here through the same inline form, because a credit
 * card is given to you BY a bank: an issuer that is only a string cannot show
 * up on that bank's page, and cannot be paid from. Creating one goes through
 * the normal accounts API, so the plan's bank limit applies exactly as it does
 * anywhere else (the picker shows the crown and the upgrade prompt instead).
 *
 * Everything printed on the plastic waits for step 2, so this step fits on a
 * phone without scrolling.
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

      <div className="space-y-2">
        <p className="text-sm font-medium" id="card-bank-label">{credit ? t("cardWizard.issuer.which") : t("cardWizard.bank.which")}</p>
        <BankPicker
          banks={banks}
          value={form.account_id}
          // A credit card's issuer IS a bank, so picking one both names the
          // issuer and pre-fills the account that will pay the statement (step
          // 4 can still change that). The branding rides along so the live
          // preview can paint the plastic before anything is saved.
          onChange={(id) => {
            const bank = banks.find((b) => b.id === id)
            onChange({
              account_id: id,
              ...(credit
                ? {
                    issuer_name: (bank?.bank_name ?? "").trim(),
                    issuer_domain: bank?.brand_domain ?? "",
                    issuer_logo_url: bank?.logo_src || bank?.logo_url || "",
                  }
                : {}),
              funding_account_id: form.funding_account_id || id,
            })
          }}
          currency={currency}
          balancesVisible={balancesVisible}
          labelId="card-bank-label"
          pickerKey={credit ? "issuer" : "bank"}
          canAddBank={canAddBank}
          onBankCreated={onBankCreated}
          onQuotaHit={() => onQuotaHit("bank")}
          autoExpandWhenEmpty
          emptyCopy={credit ? t("cardWizard.issuer.addFirst") : t("cardWizard.bank.addFirst")}
          invalid={!!errors.account_id}
          describedBy={errors.account_id ? "card-account_id-error" : undefined}
          ready={ready}
        />
        {errors.account_id ? (
          <p id="card-account_id-error" role="alert" className="text-xs text-destructive">{errors.account_id}</p>
        ) : credit ? (
          <p className="text-xs text-muted-foreground">{t("cardWizard.issuer.help")}</p>
        ) : null}
      </div>
    </div>
  )
}
