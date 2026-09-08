import { useTranslation } from "react-i18next"
import { Zap } from "lucide-react"
import type { CardWizardModeProps } from "./step-types"
import type { CardFormState } from "@/lib/card-form"
import type { CardWizardField } from "@/lib/card-wizard"
import type { Card, WealthAccount as Account } from "@/lib/types"
import { isLiabilityType } from "@/lib/credit-card"
import { CreditCardFormFields } from "@/components/wealth/CreditCardFormFields"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { StepHeading } from "./StepHeading"

const CREDIT_FIELDS: (keyof CardFormState & CardWizardField)[] = [
  "credit_limit",
  "current_debt",
  "statement_closing_day",
  "payment_due_day",
  "statement_balance",
  "statement_closing_date",
]

/**
 * Step 3 (credit only) — the numbers ProfitSync needs to track the card: the
 * limit, what is owed today (create only), the closing/due days, an optional
 * known statement; then WHO PAYS IT and whether that payment is automatic.
 *
 * "Pay from" is the same picker the Pay-card sheet uses, so the answer can be a
 * bank, cash, a debit card (an instrument — the money still leaves its bank) or
 * another credit card (a balance transfer — the debt moves, it is not cleared).
 *
 * Autopay is OFF by default and only ever mirrors a payment the bank really
 * makes, so it needs an account that HOLDS money: choosing a credit card
 * disables the switch rather than hiding it, and says why.
 */
export function StepCredit({
  form,
  onChange,
  mode,
  symbol,
  accounts,
  cards,
  ownAccountId,
  ownCardId,
  currency,
  balancesVisible,
  errors,
}: CardWizardModeProps & {
  symbol: string
  /** Every money account the workspace has — the picker decides what is payable. */
  accounts: Account[]
  cards: Card[]
  /** Edit mode: this card's own liability account and id, which can never pay it. */
  ownAccountId?: string | null
  ownCardId?: string | null
  currency: string
  balancesVisible: boolean
  errors: Partial<Record<CardWizardField, string>>
}) {
  const { t } = useTranslation("wealth")
  const fieldErrors: Partial<Record<keyof CardFormState, string>> = {}
  for (const f of CREDIT_FIELDS) if (errors[f]) fieldErrors[f] = errors[f]
  const hasFunding = !!form.funding_account_id
  // A card is paid from money you hold; paying it with another CARD is a
  // balance transfer, which is never something to do unattended.
  const payable = accounts.filter(
    (a) => !a.archived_at && a.type !== "space" && a.id !== ownAccountId,
  )
  const usable = cards.filter((c) => c.status === "active" && !c.account_archived_at && c.id !== ownCardId && c.account_id !== ownAccountId)
  const fundingAccount = accounts.find((a) => a.id === form.funding_account_id)
  const fundsFromCard = !!fundingAccount && isLiabilityType(fundingAccount.type)
  const autopayOn = hasFunding && !fundsFromCard && form.autopay

  return (
    <div className="space-y-5">
      <StepHeading id="card-credit-heading" title={t("cardWizard.credit.title")} help={mode === "edit" ? t("cardWizard.credit.editHint") : t("cardWizard.credit.help")} />

      <CreditCardFormFields
        form={form.credit}
        onChange={(patch) => onChange({ credit: { ...form.credit, ...patch } })}
        mode={mode}
        symbol={symbol}
        errors={fieldErrors}
        hideIdentity
      />

      <div className="space-y-2">
        <p className="text-sm font-medium" id="card-funding-label">{t("cardWizard.credit.payFrom")}</p>
        <p className="text-xs text-muted-foreground">{t("cardWizard.credit.payFromHelp")}</p>
        <AccountCombobox
          accounts={payable}
          cards={usable}
          cardsLayout="nested"
          value={form.funding_card_id || form.funding_account_id}
          onChange={(id, picked) =>
            onChange({
              funding_account_id: picked ? picked.account_id : id,
              funding_card_id: picked?.card_id ?? "",
              // Losing the payer, or handing it to a card, stops autopay.
              ...(!(picked ? picked.account_id : id) ? { autopay: false } : {}),
            })
          }
          currency={currency}
          balancesVisible={balancesVisible}
          allowNone
          noneLabel={t("cardWizard.credit.payManually")}
        />
        {errors.funding_account_id && (
          <p id="card-funding-error" role="alert" className="text-xs text-destructive">{errors.funding_account_id}</p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="card-autopay" className="text-sm font-medium">
              <Zap className="size-3.5 text-muted-foreground" aria-hidden />
              {t("cardWizard.credit.autopay")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground" id="card-autopay-help">
              {fundsFromCard ? t("cardWizard.credit.autopayManualOnly") : hasFunding ? t("cardWizard.credit.autopayHelp") : t("cardWizard.credit.autopayNeedsBank")}
            </p>
          </div>
          <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
            <Switch
              id="card-autopay"
              checked={autopayOn}
              disabled={!hasFunding || fundsFromCard}
              aria-describedby="card-autopay-help"
              onCheckedChange={(v) => onChange({ autopay: v })}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
