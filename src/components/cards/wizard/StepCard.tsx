import { useTranslation } from "react-i18next"
import { AlertTriangle, Link2 } from "lucide-react"
import type { Card, CardKind, CardWizardModeProps, WealthAccount } from "./step-types"
import { cardDisplayName } from "@/lib/cards"
import { isExpiryPast, nicknamePlaceholder, sanitizeLast4, type CardWizardField, type CardWizardForm } from "@/lib/card-wizard"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { BankNameCombobox } from "@/components/wealth/BankNameCombobox"
import { BankPicker } from "./BankPicker"
import { ExpiryInput } from "./ExpiryInput"
import { KindChoice } from "./KindChoice"
import { NetworkPicker } from "./NetworkPicker"

/**
 * Step 1 — the card itself: debit or credit, which bank it belongs to (or the
 * bank that issued it), then the details printed on it. Nothing here is
 * required except the bank/issuer: a user who doesn't remember the number can
 * still add the card and fill the rest in later.
 */
export function StepCard({
  form,
  onChange,
  mode,
  banks,
  selectedBank,
  currency,
  balancesVisible,
  errors,
  creditLocked,
  canAddBank,
  onQuotaHit,
  onBankCreated,
  duplicate,
  today,
  savedCard,
  ready = true,
}: CardWizardModeProps & {
  banks: WealthAccount[]
  selectedBank: WealthAccount | null
  currency: string
  balancesVisible: boolean
  errors: Partial<Record<CardWizardField, string>>
  creditLocked: boolean
  canAddBank: boolean
  onQuotaHit: (kind: "bank" | "credit_card") => void
  onBankCreated: (bank: WealthAccount) => void
  duplicate: Card | null
  today: string
  savedCard?: Card | null
  /** Banks + allowance loaded (gates the inline form's auto-expand). */
  ready?: boolean
}) {
  const { t } = useTranslation("wealth")
  const editing = mode === "edit"
  const credit = form.kind === "credit"
  const err = (field: CardWizardField) =>
    errors[field] ? (
      <p id={`card-${field}-error`} role="alert" className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null
  const describedBy = (field: CardWizardField) => (errors[field] ? `card-${field}-error` : undefined)
  const expired = isExpiryPast(form.expiry, today)

  const setKind = (kind: CardKind) => onChange({ kind })

  return (
    <div className="space-y-5">
      <KindChoice value={form.kind} onChange={setKind} creditLocked={creditLocked} onLockedCredit={() => onQuotaHit("credit_card")} readOnly={editing} />

      {/* Which bank (debit) / which issuer (credit) */}
      {editing ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{credit ? t("cardWizard.issuer.label") : t("cardWizard.bank.which")}</p>
          <div className="flex min-h-11 items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2 text-sm">
            <WealthAccountIcon
              account={{ type: "bank", icon: "bank", logo_src: credit ? savedCard?.account_logo_src ?? null : selectedBank?.logo_src ?? null, logo_url: credit ? savedCard?.account_logo_url ?? "" : selectedBank?.logo_url ?? "" }}
              className="size-8"
            />
            <span className="min-w-0 flex-1 truncate">
              <Link2 className="me-1.5 inline size-3.5 text-muted-foreground" aria-hidden />
              {t("cardWizard.bank.linked", { bank: credit ? form.issuer_name : selectedBank ? selectedBank.bank_name : savedCard?.account_bank_name ?? "" })}
            </span>
          </div>
        </div>
      ) : credit ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" id="card-issuer-label">{t("cardWizard.issuer.label")}</p>
          <div className="flex items-start gap-2" role="group" aria-labelledby="card-issuer-label" aria-describedby={describedBy("issuer_name")} data-card-issuer>
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
          {err("issuer_name") ?? <p className="text-xs text-muted-foreground">{t("cardWizard.issuer.help")}</p>}
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
            canAddBank={canAddBank}
            onBankCreated={onBankCreated}
            onQuotaHit={() => onQuotaHit("bank")}
            autoExpandWhenEmpty
            emptyCopy={t("cardWizard.bank.addFirst")}
            invalid={!!errors.account_id}
            describedBy={describedBy("account_id")}
            ready={ready}
          />
          {err("account_id")}
        </div>
      )}

      <NetworkPicker value={form.network} onChange={(network) => onChange({ network })} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="card-last4">{t("cardWizard.last4.label")}</Label>
          <Input
            id="card-last4"
            value={form.last4}
            dir="ltr"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            placeholder="1234"
            aria-invalid={!!errors.last4 || undefined}
            aria-describedby={errors.last4 ? "card-last4-error" : "card-last4-help"}
            className="min-h-11 text-base tabular-nums tracking-[0.2em]"
            onChange={(e) => onChange({ last4: sanitizeLast4(e.target.value) })}
          />
          {err("last4")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="card-expiry">{t("cardWizard.expiry.label")}</Label>
          <ExpiryInput id="card-expiry" value={form.expiry} onChange={(expiry) => onChange({ expiry })} invalid={!!errors.expiry} describedBy={describedBy("expiry")} />
          {err("expiry")}
        </div>
      </div>
      {!errors.last4 && (
        <p id="card-last4-help" className="-mt-3 text-xs text-muted-foreground">{t("cardWizard.last4.help")}</p>
      )}
      {duplicate && (
        <p role="status" className="-mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("cardWizard.last4.duplicate", { name: cardDisplayName(duplicate), last4: duplicate.last4 })}
        </p>
      )}
      {expired && (
        <p role="status" className="-mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("cardWizard.expiry.expired")}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="card-holder">{t("cardWizard.holder.label")}</Label>
        <Input
          id="card-holder"
          value={form.holder_name}
          autoComplete="cc-name"
          maxLength={80}
          placeholder={t("cardWizard.holder.placeholder")}
          className="min-h-11 text-base"
          onChange={(e) => onChange({ holder_name: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="card-nickname">{t("cardWizard.nickname.label")}</Label>
        <Input
          id="card-nickname"
          value={form.name}
          maxLength={60}
          autoComplete="off"
          placeholder={nicknamePlaceholder(form, selectedBank)}
          className="min-h-11 text-base"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t("cardWizard.nickname.help")}</p>
      </div>
    </div>
  )
}

export type { CardWizardForm }
