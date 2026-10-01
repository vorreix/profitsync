import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CURRENCY_LIST, SELECTABLE_CURRENCY_LIST, isSelectableCurrency } from "@/lib/currencies"

type Props = {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

export function CurrencyCombobox({ value, onValueChange, disabled }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // The label reads the full list, so an existing KWD account still shows its
  // currency; the options are only the ones new money may be created in — a
  // third decimal doesn't fit the money columns (MC-031) — plus a KWD this
  // picker has been GIVEN: the workspace's own (the default of a new account
  // there, which the server accepts) or the entity's current one. Kept once
  // seen, so picking USD first never loses the way back to it.
  const selected = CURRENCY_LIST.find((c) => c.code === value)
  const [kept, setKept] = useState<string | null>(null)
  if (selected && selected.code !== kept && !isSelectableCurrency(selected.code)) setKept(selected.code)
  const options = kept ? CURRENCY_LIST.filter((c) => c.code === kept || isSelectableCurrency(c.code)) : SELECTABLE_CURRENCY_LIST

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between font-normal sm:h-9"
          disabled={disabled}
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.name} (${selected.country})` : t("common.selectCurrency")}
          </span>
          <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] max-w-[calc(100vw-1.5rem)] p-0 sm:w-[400px]"
        align="start"
      >
        <Command filter={(itemValue, search) => {
          const currency = CURRENCY_LIST.find((c) => c.code === itemValue)
          if (!currency) return 0
          const q = search.toLowerCase()
          if (
            currency.code.toLowerCase().includes(q) ||
            currency.name.toLowerCase().includes(q) ||
            currency.country.toLowerCase().includes(q)
          ) return 1
          return 0
        }}>
          <CommandInput placeholder={t("common.searchCurrency")} className="text-base sm:text-sm" />
          <CommandList className="max-h-64">
            <CommandEmpty>{t("common.noCurrencyFound")}</CommandEmpty>
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.code}
                  value={c.code}
                  onSelect={(val) => {
                    onValueChange(val.toUpperCase())
                    setOpen(false)
                  }}
                >
                  <Check className={cn("me-2 size-4 shrink-0", value === c.code ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs text-muted-foreground w-10 shrink-0">{c.code}</span>
                  <span className="min-w-0 flex-auto truncate">{c.name}</span>
                  {/* The country gives way first, so the currency name stays whole. */}
                  <span className="ms-2 min-w-0 shrink-[1000] truncate text-xs text-muted-foreground">{c.country}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
