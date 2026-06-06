import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { accountFieldsForCountry, PRIMARY_LABEL_KEY, SECONDARY_LABEL_KEY } from "@/lib/bank-fields"
import type { BankFormState } from "@/lib/bank-form"
import { BankNameCombobox } from "@/components/wealth/BankNameCombobox"
import { IconSelect } from "@/components/wealth/icon-select"
import { CountryCombobox } from "@/components/CountryCombobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function BankAccountFormFields({
  form,
  onChange,
  autoFocusName,
  beforeBankDetails,
}: {
  form: BankFormState
  onChange: (patch: Partial<BankFormState>) => void
  autoFocusName?: boolean
  /** Optional content rendered just above the "Bank Details" section (e.g. Opening Balance on create). */
  beforeBankDetails?: ReactNode
}) {
  const { t } = useTranslation("wealth")
  const fields = accountFieldsForCountry(form.country)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("bankName")}</Label>
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("nickname")}</Label>
          <Input value={form.nickname} placeholder={t("mainAccountPlaceholder")} onChange={(e) => onChange({ nickname: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("logoIcon")}</Label>
          <IconSelect value={form.icon} onChange={(icon) => onChange({ icon })} />
        </div>
      </div>

      {beforeBankDetails}

      <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("bankDetails")} <span className="font-normal normal-case">· {t("optional")}</span>
        </p>
        <div className="space-y-1.5">
          <Label>{t("country")}</Label>
          <CountryCombobox value={form.country} onValueChange={(c) => onChange({ country: c })} placeholder={t("selectCountry")} />
        </div>
        <div className="space-y-1.5">
          <Label>{t(PRIMARY_LABEL_KEY[fields.primaryKey])}</Label>
          <Input value={form.account_number} onChange={(e) => onChange({ account_number: e.target.value })} />
        </div>
        {fields.secondaryKey && (
          <div className="space-y-1.5">
            <Label>{t(SECONDARY_LABEL_KEY[fields.secondaryKey])}</Label>
            <Input value={form.routing_number} onChange={(e) => onChange({ routing_number: e.target.value })} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{t("fieldSwift")}</Label>
          <Input value={form.swift} placeholder="ABCDITMM" onChange={(e) => onChange({ swift: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("location")}</Label>
          <Input value={form.location} placeholder={t("locationPlaceholder")} onChange={(e) => onChange({ location: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("address")}</Label>
          <Textarea rows={2} className="resize-none" value={form.address} onChange={(e) => onChange({ address: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("note")}</Label>
          <Textarea rows={2} className="resize-none" value={form.note} onChange={(e) => onChange({ note: e.target.value })} />
        </div>
      </div>
    </div>
  )
}
