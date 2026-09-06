import { useTranslation } from "react-i18next"
import { AlertTriangle, Link2 } from "lucide-react"
import type { Card, CardWizardModeProps, WealthAccount } from "./step-types"
import { cardDisplayName } from "@/lib/cards"
import { isExpiryPast, nicknamePlaceholder, requiredCardDetails, sanitizeLast4, type CardWizardField, type CardWizardForm } from "@/lib/card-wizard"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { ExpiryInput } from "./ExpiryInput"
import { NetworkPicker } from "./NetworkPicker"
import { StepHeading } from "./StepHeading"

/**
 * Step 2 — what is printed on the card: network, the number's tail, the expiry
 * and the name on it. These are MANDATORY when adding a card: without them the
 * app can only draw a blank rectangle, and the user can't tell two cards apart.
 * The nickname stays optional because it derives from the bank + network
 * (shown as the placeholder), so a card is never nameless.
 *
 * Editing is gentler: a card saved before this rule keeps its blanks (see
 * requiredCardDetails) — it can be completed here, never blocked here.
 */
export function StepDetails({
  form,
  onChange,
  mode,
  initial,
  selectedBank,
  errors,
  duplicate,
  today,
  savedCard,
}: CardWizardModeProps & {
  /** The form as it was seeded — decides which blanks an edit may keep. */
  initial?: CardWizardForm | null
  selectedBank: WealthAccount | null
  errors: Partial<Record<CardWizardField, string>>
  duplicate: Card | null
  today: string
  savedCard?: Card | null
}) {
  const { t } = useTranslation("wealth")
  const editing = mode === "edit"
  const credit = form.kind === "credit"
  const need = requiredCardDetails(mode, initial)
  const err = (field: CardWizardField) =>
    errors[field] ? (
      <p id={`card-${field}-error`} role="alert" className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null
  const describedBy = (field: CardWizardField, help?: string) => (errors[field] ? `card-${field}-error` : help)
  const expired = isExpiryPast(form.expiry, today)
  const bankName = credit ? form.issuer_name : selectedBank?.bank_name ?? savedCard?.account_bank_name ?? ""

  return (
    <div className="space-y-5">
      <StepHeading id="card-details-heading" title={t("cardWizard.details.title")} help={t("cardWizard.details.help")} />

      {/* Editing skips the type step, so the card's fixed facts are restated here. */}
      {editing && (
        <div className="flex min-h-11 items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2 text-sm">
          <WealthAccountIcon
            account={{
              type: "bank",
              icon: "bank",
              logo_src: credit ? savedCard?.account_logo_src ?? null : selectedBank?.logo_src ?? null,
              logo_url: credit ? savedCard?.account_logo_url ?? "" : selectedBank?.logo_url ?? "",
            }}
            className="size-8"
          />
          <span className="min-w-0 flex-1 truncate">
            <Link2 className="me-1.5 inline size-3.5 text-muted-foreground" aria-hidden />
            {t("cardWizard.bank.linked", { bank: bankName })}
          </span>
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {credit ? t("cardWizard.kind.credit") : t("cardWizard.kind.debit")}
          </span>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium" id="card-network-label">{t("cardWizard.network.label")}</p>
        <NetworkPicker
          value={form.network}
          onChange={(network) => onChange({ network })}
          labelId="card-network-label"
          invalid={!!errors.network}
          describedBy={describedBy("network")}
        />
        {err("network")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="card-last4">{t("cardWizard.last4.labelRange")}</Label>
          <Input
            id="card-last4"
            value={form.last4}
            dir="ltr"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            placeholder="1234"
            aria-required={need.last4 || undefined}
            aria-invalid={!!errors.last4 || undefined}
            aria-describedby={describedBy("last4", "card-last4-help")}
            className="min-h-11 text-base tabular-nums tracking-[0.18em]"
            onChange={(e) => onChange({ last4: sanitizeLast4(e.target.value) })}
          />
          {err("last4")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="card-expiry">{t("cardWizard.expiry.label")}</Label>
          <ExpiryInput
            id="card-expiry"
            value={form.expiry}
            onChange={(expiry) => onChange({ expiry })}
            required={need.expiry}
            invalid={!!errors.expiry}
            describedBy={describedBy("expiry")}
          />
          {err("expiry")}
        </div>
      </div>
      {!errors.last4 && !errors.expiry && (
        <p id="card-last4-help" className="-mt-3 text-xs text-muted-foreground">{t("cardWizard.last4.helpRange")}</p>
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
          aria-required={need.holder || undefined}
          aria-invalid={!!errors.holder_name || undefined}
          aria-describedby={describedBy("holder_name")}
          className="min-h-11 text-base"
          onChange={(e) => onChange({ holder_name: e.target.value })}
        />
        {err("holder_name")}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="card-nickname" className="gap-1.5">
          {t("cardWizard.nickname.label")}
          <span className="font-normal text-muted-foreground">{t("cardWizard.optional")}</span>
        </Label>
        {/* The placeholder IS the fallback name (cardDisplayName), so the field
            explains itself and the card is never nameless. */}
        <Input
          id="card-nickname"
          value={form.name}
          maxLength={60}
          autoComplete="off"
          placeholder={nicknamePlaceholder(form, selectedBank ?? { bank_name: bankName, nickname: "" })}
          className="min-h-11 text-base"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
    </div>
  )
}
