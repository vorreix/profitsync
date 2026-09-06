import { useEffect, useId, useState, type KeyboardEvent } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Check, Crown, HandCoins, Loader as Loader2, Plus } from "lucide-react"
import { apiErrorMessage, apiErrorUpgradeHint, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import type { WealthAccount } from "@/lib/types"
import { accountDisplayName, currencySymbol, formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { BankNameCombobox } from "@/components/wealth/BankNameCombobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Pick one of the workspace's active banks (logo, name, balance), or add one
 * right here: the inline mini-form creates the bank through the normal
 * POST /api/wealth/accounts and selects it. At the plan's bank allowance the
 * form gives way to the crown, which hands off to the upgrade prompt.
 *
 * With `allowNone` a first row offers "no bank" (value "") — the credit
 * step's "Skip — I'll pay it manually".
 */
export function BankPicker({
  banks,
  value,
  onChange,
  currency,
  balancesVisible,
  labelId,
  canAddBank,
  onBankCreated,
  onQuotaHit,
  allowNone = false,
  noneLabel,
  autoExpandWhenEmpty = false,
  emptyCopy,
  invalid = false,
  describedBy,
  ready = true,
}: {
  banks: WealthAccount[]
  value: string
  onChange: (id: string) => void
  currency: string
  balancesVisible: boolean
  /** id of the element that labels this group. */
  labelId: string
  canAddBank: boolean
  onBankCreated: (bank: WealthAccount) => void
  onQuotaHit: () => void
  allowNone?: boolean
  noneLabel?: string
  /** Open the inline form by itself when there is no bank yet. */
  autoExpandWhenEmpty?: boolean
  /** Heading of the inline form when it opens by itself ("Add the bank this card belongs to"). */
  emptyCopy?: string
  invalid?: boolean
  describedBy?: string
  /** False while the banks / plan allowance are still loading — nothing auto-expands until then. */
  ready?: boolean
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const uid = useId()
  const symbol = currencySymbol(currency)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [domain, setDomain] = useState("")
  const [logoUrl, setLogoUrl] = useState("")
  const [balance, setBalance] = useState("")
  const [saving, setSaving] = useState(false)

  const empty = banks.length === 0
  useEffect(() => {
    if (!ready) return
    if (autoExpandWhenEmpty && empty && canAddBank) setAdding(true)
    // The allowance turned out to be used up (loaded late, or another tab added
    // a bank): the form can only end in a 402, so give way to the crown.
    if (!canAddBank) setAdding((a) => (a && !saving ? false : a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoExpandWhenEmpty, empty, canAddBank])

  const options: { id: string; row: WealthAccount | null }[] = [
    ...(allowNone ? [{ id: "", row: null }] : []),
    ...banks.map((b) => ({ id: b.id, row: b })),
  ]

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0
    if (!dir || options.length === 0) return
    e.preventDefault()
    const i = Math.max(0, options.findIndex((o) => o.id === value))
    const next = options[(i + dir + options.length) % options.length]
    onChange(next.id)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-bank-option="${next.id || "none"}"]`)?.focus()
  }

  function openForm() {
    if (!canAddBank) {
      onQuotaHit()
      return
    }
    setAdding(true)
  }

  function closeForm() {
    setAdding(false)
    setName("")
    setDomain("")
    setLogoUrl("")
    setBalance("")
  }

  async function createBank() {
    const bankName = name.trim()
    if (!bankName) return
    const opening = balance.trim() === "" ? 0 : Number(balance)
    if (!Number.isFinite(opening) || amountExceedsLimit(opening)) {
      toast.error(t("cardWizard.errors.amountTooLarge"))
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const row = await apiPost<WealthAccount>("/api/wealth/accounts", token, {
        type: "bank",
        bank_name: bankName,
        opening_balance: opening,
        icon: "bank",
        brand_domain: domain,
        logo_url: logoUrl,
      })
      onBankCreated(row)
      onChange(row.id)
      toast.success(t("cardWizard.bank.created"))
      closeForm()
    } catch (err) {
      if (apiErrorUpgradeHint(err)) {
        closeForm()
        onQuotaHit()
      } else {
        toast.error(apiErrorMessage(err, t("cardWizard.bank.createFailed")))
      }
    } finally {
      setSaving(false)
    }
  }

  const noneSelected = value === ""
  const anySelected = allowNone ? true : banks.some((b) => b.id === value)

  return (
    <div className="space-y-2">
      {options.length > 0 && (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("space-y-1.5", invalid && "rounded-xl ring-1 ring-destructive/40")}
          onKeyDown={onKeyDown}
        >
          {allowNone && (
            <button
              type="button"
              role="radio"
              aria-checked={noneSelected}
              tabIndex={noneSelected || !anySelected ? 0 : -1}
              data-bank-option="none"
              onClick={() => onChange("")}
              className={cn(
                "pressable ios-tap flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                noneSelected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
                <HandCoins className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{noneLabel ?? t("cardWizard.bank.noneOption")}</span>
              {noneSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
            </button>
          )}
          {banks.map((b) => {
            const selected = value === b.id
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-bank-option={b.id}
                onClick={() => onChange(b.id)}
                className={cn(
                  "pressable ios-tap flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
                )}
              >
                <WealthAccountIcon account={b} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{accountDisplayName(b)}</span>
                  {b.nickname.trim() && <span className="block truncate text-xs text-muted-foreground">{b.bank_name}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMoney(Number(b.current_balance), currency, balancesVisible)}</span>
                {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </button>
            )
          })}
        </div>
      )}

      {adding ? (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
          <p className="text-sm font-medium">{empty && emptyCopy ? emptyCopy : t("cardWizard.bank.addNew")}</p>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-bank-name`}>{t("cardWizard.bank.name")}</Label>
            <div className="flex items-start gap-2">
              {logoUrl && (
                <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-md border bg-card object-contain p-0.5" onError={(e) => { e.currentTarget.style.display = "none" }} />
              )}
              <div className="min-w-0 flex-1 [&_input]:min-h-11 [&_input]:text-base">
                <BankNameCombobox
                  value={name}
                  onChange={setName}
                  onSelectBrand={(b) => { setName(b.name); setDomain(b.domain); setLogoUrl(b.logoUrl) }}
                  placeholder={t("searchBankName")}
                  autoFocus
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-bank-balance`}>{t("cardWizard.bank.openingBalance", { symbol })}</Label>
            <Input
              id={`${uid}-bank-balance`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={balance}
              placeholder={`${symbol} 0.00`}
              className="min-h-11 text-base"
              onChange={(e) => setBalance(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createBank() } }}
            />
          </div>
          <div className="flex justify-end gap-2">
            {!(empty && autoExpandWhenEmpty) && (
              <Button type="button" variant="outline" className="min-h-11" onClick={closeForm} disabled={saving}>
                {t("cardWizard.bank.cancel")}
              </Button>
            )}
            <Button type="button" className="min-h-11" onClick={() => void createBank()} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {saving ? t("cardWizard.bank.creating") : t("cardWizard.bank.create")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openForm}
          className={cn(
            "pressable ios-tap flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed px-3 py-2 text-start text-sm transition-colors hover:bg-muted/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            !canAddBank && "text-muted-foreground",
          )}
        >
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border", canAddBank ? "bg-muted/50 text-foreground" : "bg-amber-500/10")}>
            {canAddBank ? <Plus className="size-4" aria-hidden /> : <Crown className="size-4 text-amber-500 dark:text-amber-400" aria-hidden />}
          </span>
          <span className="font-medium">{canAddBank ? t("cardWizard.bank.addNew") : t("cardWizard.bank.upgrade")}</span>
        </button>
      )}
    </div>
  )
}
