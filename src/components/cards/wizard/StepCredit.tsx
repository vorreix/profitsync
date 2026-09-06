import { useTranslation } from "react-i18next"
import { Zap } from "lucide-react"
import type { CardWizardModeProps, WealthAccount } from "./step-types"
import type { CardFormState } from "@/lib/card-form"
import type { CardWizardField } from "@/lib/card-wizard"
import { CreditCardFormFields } from "@/components/wealth/CreditCardFormFields"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { BankPicker } from "./BankPicker"

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
 * known statement; then which bank pays it and whether that payment is
 * automatic. Autopay is OFF by default — it only mirrors a payment the bank
 * really makes.
 */
export function StepCredit({
  form,
  onChange,
  mode,
  symbol,
  banks,
  currency,
  balancesVisible,
  errors,
  canAddBank,
  onBankCreated,
  onQuotaHit,
  ready = true,
}: CardWizardModeProps & {
  symbol: string
  banks: WealthAccount[]
  currency: string
  balancesVisible: boolean
  errors: Partial<Record<CardWizardField, string>>
  canAddBank: boolean
  onBankCreated: (bank: WealthAccount) => void
  onQuotaHit: () => void
  ready?: boolean
}) {
  const { t } = useTranslation("wealth")
  const fieldErrors: Partial<Record<keyof CardFormState, string>> = {}
  for (const f of CREDIT_FIELDS) if (errors[f]) fieldErrors[f] = errors[f]
  const hasFunding = !!form.funding_account_id
  const autopayOn = hasFunding && form.autopay

  return (
    <div className="space-y-5">
      {mode === "edit" && <p className="text-xs text-muted-foreground">{t("cardWizard.credit.editHint")}</p>}

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
        <BankPicker
          banks={banks}
          value={form.funding_account_id}
          onChange={(id) => onChange({ funding_account_id: id, ...(id ? {} : { autopay: false }) })}
          currency={currency}
          balancesVisible={balancesVisible}
          labelId="card-funding-label"
          canAddBank={canAddBank}
          onBankCreated={onBankCreated}
          onQuotaHit={onQuotaHit}
          allowNone
          ready={ready}
          invalid={!!errors.funding_account_id}
          describedBy={errors.funding_account_id ? "card-funding-error" : undefined}
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
              {hasFunding ? t("cardWizard.credit.autopayHelp") : t("cardWizard.credit.autopayNeedsBank")}
            </p>
          </div>
          <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
            <Switch
              id="card-autopay"
              checked={autopayOn}
              disabled={!hasFunding}
              aria-describedby="card-autopay-help"
              onCheckedChange={(v) => onChange({ autopay: v })}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
