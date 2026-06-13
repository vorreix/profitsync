import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDialogContainer } from "@/hooks/use-dialog-container"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { accountDisplayName, formatMoney } from "@/lib/wealth"
import type { WealthAccount } from "@/lib/types"

/**
 * Searchable account picker showing each account's logo, name and balance.
 * Reused by the wealth transfer wizard and the Spaces fund/withdraw + auto-save
 * modals. Dialog-aware (portals the popover into the dialog so it scrolls).
 */
export function AccountCombobox({
  accounts, value, onChange, currency, placeholder, disabled, excludeIds, balancesVisible = true,
}: {
  accounts: WealthAccount[]
  value: string
  onChange: (id: string) => void
  currency: string
  placeholder?: string
  disabled?: boolean
  excludeIds?: string[]
  balancesVisible?: boolean
}) {
  const { t } = useTranslation("wealth")
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const options = useMemo(() => accounts.filter((a) => !excludeIds?.includes(a.id)), [accounts, excludeIds])
  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () => options.filter((a) => accountDisplayName(a).toLowerCase().includes(q) || a.bank_name.toLowerCase().includes(q)),
    [options, q],
  )
  const selected = accounts.find((a) => a.id === value)

  function close() { setOpen(false); setSearch("") }

  return (
    <div ref={triggerRef} className="contents">
      <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between font-normal" disabled={disabled}>
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <WealthAccountIcon account={selected} className="size-5" />
                <span className="truncate">{accountDisplayName(selected)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatMoney(Number(selected.current_balance), currency, balancesVisible)}</span>
              </span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder ?? t("selectAccount")}</span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          container={container}
          className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[var(--radix-popover-trigger-width)] min-w-[14rem] flex-col overflow-hidden p-0"
          align="start"
        >
          <div className="shrink-0 border-b p-2">
            <Input placeholder={t("searchAccounts")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" autoFocus />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-1">
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => { onChange(a.id); close() }}
              >
                <Check className={cn("size-4 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                <WealthAccountIcon account={a} className="size-6" />
                <span className="min-w-0 flex-1 truncate">{accountDisplayName(a)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatMoney(Number(a.current_balance), currency, balancesVisible)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("noAccountFound")}</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
