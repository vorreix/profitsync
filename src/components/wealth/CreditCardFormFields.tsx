import { useTranslation } from "react-i18next"
import type { CardFormState } from "@/lib/card-form"
import { BankNameCombobox } from "@/components/wealth/BankNameCombobox"
import { IconSelect } from "@/components/wealth/icon-select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/**
 * Credit-card account form: issuer (with logo autocomplete), name, limit, the
 * amount owed today (create only — later it's adjusted from the card screen),
 * fixed closing / due days, and an optional "latest statement" the user already
 * knows. Plain words on purpose: "Amount you owe", not "outstanding balance".
 */
export function CreditCardFormFields({
  form,
  onChange,
  mode,
  symbol,
  autoFocusName,
  errors = {},
}: {
  form: CardFormState
  onChange: (patch: Partial<CardFormState>) => void
  mode: "create" | "edit"
  symbol: string
  autoFocusName?: boolean
  errors?: Partial<Record<keyof CardFormState, string>>
}) {
  const { t } = useTranslation("wealth")
  const err = (k: keyof CardFormState) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("cardIssuer")}</Label>
        <div className="flex items-start gap-2">
          {form.logo_url && (
            <img src={form.logo_url} alt="" className="size-9 shrink-0 rounded-md border bg-card object-contain p-0.5" onError={(e) => { e.currentTarget.style.display = "none" }} />
          )}
          <div className="min-w-0 flex-1">
            <BankNameCombobox
              value={form.bank_name}
              onChange={(name) => onChange({ bank_name: name })}
              onSelectBrand={(b) => onChange({ bank_name: b.name, brand_domain: b.domain, logo_url: b.logoUrl })}
              placeholder={t("searchBankName")}
              autoFocus={autoFocusName}
            />
          </div>
        </div>
        {err("bank_name")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cc-nickname">{t("nickname")}</Label>
          <Input id="cc-nickname" value={form.nickname} placeholder={t("cardNamePlaceholder")} onChange={(e) => onChange({ nickname: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("logoIcon")}</Label>
          <IconSelect value={form.icon} onChange={(icon) => onChange({ icon })} />
        </div>
      </div>

      <div className={mode === "create" ? "grid grid-cols-2 gap-3" : "space-y-1.5"}>
        <div className="space-y-1.5">
          <Label htmlFor="cc-limit">{t("creditLimitLabel", { symbol })}</Label>
          <Input
            id="cc-limit"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={form.credit_limit}
            placeholder={`${symbol} 2,000.00`}
            aria-invalid={!!errors.credit_limit}
            onChange={(e) => onChange({ credit_limit: e.target.value })}
          />
          {err("credit_limit")}
        </div>
        {mode === "create" && (
          <div className="space-y-1.5">
            <Label htmlFor="cc-debt">{t("amountOwedLabel", { symbol })}</Label>
            <Input
              id="cc-debt"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.current_debt}
              placeholder={`${symbol} 0.00`}
              aria-invalid={!!errors.current_debt}
              onChange={(e) => onChange({ current_debt: e.target.value })}
            />
            {err("current_debt")}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-closing">{t("statementClosingDay")}</Label>
            <Input
              id="cc-closing"
              type="number"
              inputMode="numeric"
              min="1"
              max="31"
              step="1"
              value={form.statement_closing_day}
              placeholder={t("dayPlaceholder", { day: 1 })}
              aria-invalid={!!errors.statement_closing_day}
              onChange={(e) => onChange({ statement_closing_day: e.target.value })}
            />
            {err("statement_closing_day")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-due">{t("paymentDueDay")}</Label>
            <Input
              id="cc-due"
              type="number"
              inputMode="numeric"
              min="1"
              max="31"
              step="1"
              value={form.payment_due_day}
              placeholder={t("dayPlaceholder", { day: 15 })}
              aria-invalid={!!errors.payment_due_day}
              onChange={(e) => onChange({ payment_due_day: e.target.value })}
            />
            {err("payment_due_day")}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("dayHint")}</p>
      </div>

      {mode === "create" && (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="cc-know" className="text-sm font-medium">{t("knownStatement")}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("knownStatementHint")}</p>
            </div>
            <Switch id="cc-know" checked={form.know_statement} onCheckedChange={(v) => onChange({ know_statement: v })} aria-label={t("knownStatement")} />
          </div>
          {form.know_statement ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cc-st-balance">{t("statementBalanceLabel", { symbol })}</Label>
                <Input id="cc-st-balance" type="number" inputMode="decimal" min="0" step="0.01" value={form.statement_balance} aria-invalid={!!errors.statement_balance} onChange={(e) => onChange({ statement_balance: e.target.value })} />
                {err("statement_balance")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cc-st-close">{t("statementClosingDate")}</Label>
                  <Input id="cc-st-close" type="date" value={form.statement_closing_date} aria-invalid={!!errors.statement_closing_date} onChange={(e) => onChange({ statement_closing_date: e.target.value })} />
                  {err("statement_closing_date")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cc-st-due">{t("statementDueDate")}</Label>
                  <Input id="cc-st-due" type="date" value={form.statement_due_date} onChange={(e) => onChange({ statement_due_date: e.target.value })} />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("dontKnowStatement")}</p>
          )}
        </div>
      )}
    </div>
  )
}
